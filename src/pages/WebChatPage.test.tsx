// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebChatPage from "./WebChatPage";
import { webChatPersistence } from "@/lib/web-chat-persistence";
import { ChatTestSocket } from "@/test/web-chat-server";
import { input, json, mountEditor, press, profileResponse, setupEditorDOM, unloadPrevented } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>> | undefined;
let tickets: number;
const latest = () => ChatTestSocket.instances.at(-1)!;
const composer = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-autocomplete="list"]')!;
const prompts = () => ChatTestSocket.instances.flatMap((socket) => socket.frames.filter((frame) => frame.method === "prompt.submit"));
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
const tabButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tabMenu = () => document.querySelector<HTMLElement>('[role="menu"][aria-label="Open conversation tab"]')!;
const activeTab = () => document.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;

function seedSession(id: string, title: string) {
  const conversation = {
    session_id: "live-" + id, stored_session_id: id,
    messages: [{ role: "user", text: title }, { role: "assistant", text: "Reply to " + title }],
    info: { model: "test-model", profile_name: "A", title }, running: false,
  };
  ChatTestSocket.conversations.set(id, conversation);
  return conversation;
}

beforeEach(() => {
  setupEditorDOM();
  ChatTestSocket.reset();
  tickets = 0;
  window.__HERMES_AUTH_REQUIRED__ = false;
  window.__HERMES_SESSION_TOKEN__ = "test-session-token";
  vi.stubGlobal("WebSocket", ChatTestSocket);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/auth/ws-ticket") return json({ ticket: "ticket-" + ++tickets, ttl_seconds: 30 });
    return profileResponse(path) ?? json({});
  }));
});

afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete window.__HERMES_SESSION_TOKEN__;
  delete window.__HERMES_AUTH_REQUIRED__;
});

describe("Web Chat over the real JSON-RPC client", () => {
  it("keeps streamed reasoning and text mounted when tools start and an earlier tool group is collapsed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const publish = () => act(async () => { await vi.advanceTimersByTimeAsync(20); });
    app = await mountEditor(<WebChatPage />, undefined, true);
    await input(composer(), "Inspect the project"); await press("Send");
    await act(async () => { latest().event("reasoning.delta", { text: "Reasoning before the tools" }); });
    await publish();
    const firstReply = document.querySelector('article[aria-label="Hermes"]');
    expect(firstReply).not.toBeNull();
    const reasoning = firstReply!.querySelector<HTMLDetailsElement>("details")!;
    await act(async () => { reasoning.open = true; reasoning.dispatchEvent(new Event("toggle")); });
    await act(async () => { latest().event("message.delta", { text: "Checking the project" }); });
    await publish();
    expect(document.querySelector('article[aria-label="Hermes"]')).toBe(firstReply);
    expect(reasoning.open).toBe(true);
    await act(async () => {
      latest().event("tool.start", { tool_id: "first-tool", name: "terminal" });
      latest().event("tool.complete", { tool_id: "first-tool", name: "terminal", result_text: "First result" });
    });
    await publish();
    expect(document.querySelector('article[aria-label="Hermes"]')).toBe(firstReply);
    expect(reasoning.open).toBe(true);
    const group = document.querySelector<HTMLDetailsElement>('details[data-chat-detail$=":activity"]')!;
    await act(async () => { group.open = false; group.dispatchEvent(new Event("toggle")); });
    await act(async () => { latest().event("message.delta", { text: "Now checking the next file" }); });
    await publish();
    const secondReply = [...document.querySelectorAll('article[aria-label="Hermes"]')].at(-1)!;
    await act(async () => { latest().event("tool.start", { tool_id: "second-tool", name: "read_file" }); });
    await publish();
    expect([...document.querySelectorAll('article[aria-label="Hermes"]')].at(-1)).toBe(secondReply);
    expect(secondReply.textContent).toContain("Now checking the next file");
    expect(secondReply.closest("details")).toBeNull();
    expect(group.open).toBe(false);
  });

  it("reuses history media across tabs/routes and releases the cache on profile replacement", async () => {
    const stored = seedSession("image-history", "Image history");
    stored.messages[0].text += "\n@image:/images/history.png";
    webChatPersistence("A").remember(stored.stored_session_id);
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    const mediaProfiles: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/media") {
        mediaProfiles.push(parsed.searchParams.get("profile")!);
        return json({ data_url: "data:image/png;base64,aGVsbG8=" });
      }
      return fallback(url, init);
    }));
    app = await mountEditor(<WebChatPage />, undefined, true); await settle();
    expect(document.querySelector('img[src="data:image/png;base64,aGVsbG8="]')).not.toBeNull();
    await press("Open conversation tab"); await press("New chat", tabMenu());
    await act(async () => { tabButtons().find(tab => tab.dataset.sessionId === stored.stored_session_id)!.click(); });
    await press("Leave editor");
    await act(async () => { await app!.router.navigate("/edit"); }); await settle();
    expect(mediaProfiles).toEqual(["A"]);
    expect(document.querySelector('img[src="data:image/png;base64,aGVsbG8="]')).not.toBeNull();
    await press("Switch profile"); await settle();
    await press("Switch profile"); await settle();
    expect(mediaProfiles).toEqual(["A", "A"]);
  });

  it("displays the stored model_config identity despite incorrect WS/catalog providers and reuses it on tab switches", async () => {
    const stored = seedSession("model-history", "Stored model conversation");
    Object.assign(stored.info, { provider: "custom:gemini", model: "gpt-6.1-sol" });
    webChatPersistence("A").remember(stored.stored_session_id);
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    const detailReads: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname === "/api/sessions/model-history") {
        detailReads.push(url);
        return json({ id: stored.stored_session_id, model: "gpt-6.1-sol", model_config: JSON.stringify({
          provider: "custom:yyapi-responses", model: "gpt-6.1-sol", api_mode: "codex_responses",
        }) });
      }
      return fetchDefault(url, init);
    }));
    const send = ChatTestSocket.prototype.send;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "model.options") {
        this.frames.push(frame);
        this.receive({ id: frame.id, result: { provider: "custom:gemini", model: "gpt-6.1-sol", providers: [
          { slug: "custom:gemini", name: "Gemini", models: ["gemini-model"] },
          { slug: "custom:yyapi-responses", name: "YYAPI Responses", models: ["gpt-6.1-sol"] },
        ] } });
      } else send.call(this, text);
    });
    app = await mountEditor(<WebChatPage />, undefined, true);
    await settle();
    const label = "custom:yyapi-responses/gpt-6.1-sol";
    expect(document.querySelector(`button[title="${label}"]`)).not.toBeNull();
    expect(new URL(detailReads[0], "http://localhost").searchParams.get("profile")).toBe("A");
    await press("Switch model: " + label);
    expect(document.querySelector('[aria-label="Models"] button[aria-checked="true"]')?.textContent).toBe("gpt-6.1-sol");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { latest().event("session.info", { provider: "custom:gemini", model: "gpt-6.1-sol" }); });
    expect(document.querySelector(`button[title="${label}"]`)).not.toBeNull();
    const reads = detailReads.length;
    await press("Open conversation tab"); await press("New chat", tabMenu());
    await act(async () => { tabButtons().find(tab => tab.dataset.sessionId === stored.stored_session_id)!.click(); });
    expect(document.querySelector(`button[title="${label}"]`)).not.toBeNull();
    expect(detailReads).toHaveLength(reads);
  });

  it("streams scoped turns, answers human requests safely, and stops only at the terminal event", async () => {
    app = await mountEditor(<WebChatPage />, undefined, true);
    await settle();
    expect(latest().url).toContain("/api/ws?token=test-session-token");
    expect(latest().frames.find((frame) => frame.method === "session.create")?.params?.profile).toBe("A");
    expect(latest().frames.find((frame) => frame.method === "client.capabilities")?.params?.server_requests).toBe(true);

    await input(composer(), "First question");
    await act(async () => { composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
    await act(async () => { composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); });
    expect(prompts()).toHaveLength(0);
    await press("Send");
    expect(prompts()).toHaveLength(1);
    expect(composer().value).toBe("");
    const userMessage = document.querySelector('article[aria-label="You"]')!;
    const bubble = userMessage.firstElementChild!;
    expect(bubble.textContent).toBe("First question");
    expect(bubble.querySelector("button")).toBeNull();
    expect(userMessage.querySelector('button[aria-label="Copy message"]')).not.toBeNull();
    expect(userMessage.querySelector("time")?.getAttribute("datetime")).toBeTruthy();

    await act(async () => {
      latest().event("message.delta", { text: "FOREIGN" }, "someone-else");
      latest().event("reasoning.delta", { text: "Thinking carefully" });
      latest().event("message.delta", { text: "Checking project" });
      latest().event("message.interim", { text: "Checking project", already_streamed: true });
      latest().event("tool.start", { tool_id: "tool-1", name: "terminal", context: "Inspect project" });
      latest().event("tool.complete", { tool_id: "tool-1", name: "terminal", summary: "Files inspected" });
      latest().event("message.delta", { text: "**Answer**" });
      latest().request("approval-1", "approval", { request_id: "permission-1", command: "write a file", choices: ["once", "deny"] });
    });
    expect(document.body.textContent).not.toContain("FOREIGN");
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Checking project");
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Files inspected");
    expect(latest().frames.find((frame) => frame.id === "approval-1")).toBeUndefined();
    await press("Deny");
    expect(latest().frames.find((frame) => frame.id === "approval-1")?.result).toEqual({ choice: "deny" });

    await act(async () => { latest().request("question-1", "clarify", { question: "Which approach?", choices: ["A", "B"] }); });
    await press("B", document.querySelector('form[aria-label="Hermes has a question"]')!);
    await press("Continue");
    expect(latest().frames.find((frame) => frame.id === "question-1")?.result).toEqual({ answer: "B" });
    await act(async () => { latest().request("secret-1", "secret", { env_var: "TEST_KEY", prompt: "Enter a key" }); });
    await input(document.querySelector<HTMLInputElement>('input[type="password"]')!, "private-test-value");
    await press("Continue");
    expect(latest().frames.find((frame) => frame.id === "secret-1")?.result).toEqual({ value: "private-test-value" });
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("private-test-value");
    expect(Object.values(sessionStorage).join(" ")).not.toContain("private-test-value");
    await act(async () => { latest().request("unsupported", "vault.unlock"); });
    expect(latest().frames.find((frame) => frame.id === "unsupported")?.error?.code).toBe(-32601);

    await press("Stop");
    expect(latest().frames.find((frame) => frame.method === "session.interrupt")?.params?.session_id).toBe(latest().conversation!.session_id);
    expect(document.body.textContent).toContain("Stopping…");
    await act(async () => { latest().finish("Final answer", "interrupted"); });
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Final answer");
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Stopped");
    expect(prompts()).toHaveLength(1);

    ChatTestSocket.rejectNext = true;
    await input(composer(), "Keep this draft");
    await press("Send");
    expect(composer().value).toBe("Keep this draft");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Request refused");
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("Keep this draft");
  });

  it("uses fresh login tickets and restores A→B→A without resending ambiguous turns or losing pending approvals", async () => {
    window.__HERMES_AUTH_REQUIRED__ = true;
    app = await mountEditor(<WebChatPage />, undefined, true);
    await settle();
    const a = latest().conversation!;
    expect(latest().url).toContain("ticket=ticket-1");
    await input(composer(), "A's question");
    await press("Send");
    await act(async () => { latest().finish("A's reply"); });

    await press("Switch profile");
    await settle();
    const b = latest().conversation!;
    expect(b.info.profile_name).toBe("B");
    expect(document.querySelector('[role="log"]')).toBeNull();
    await input(composer(), "B's question");
    await press("Send");
    await act(async () => { latest().finish("B's reply"); });
    await press("Switch profile");
    await settle();
    expect(latest().frames.find((frame) => frame.method === "session.resume")?.params).toMatchObject({ profile: "A", session_id: a.stored_session_id });
    expect(document.querySelector('[role="log"]')?.textContent).toContain("A's reply");
    expect(document.querySelector('[role="log"]')?.textContent).not.toContain("B's reply");

    ChatTestSocket.loseNextAck = true;
    await input(composer(), "Possibly accepted");
    await press("Send");
    const count = prompts().length;
    a.open_requests = [{ id: "replayed-approval", method: "approval", params: { session_id: a.session_id, request_id: "permission-2", command: "continue task", choices: ["once", "deny"] } }];
    await press("Reconnect");
    await settle();
    expect(latest().url).toContain("ticket=ticket-4");
    expect(prompts()).toHaveLength(count);
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Possibly accepted");
    expect(document.body.textContent).toContain("Approval required");
    await press("Allow once");
    expect(latest().frames.find((frame) => frame.id === "replayed-approval")?.result).toEqual({ choice: "once" });
    await act(async () => { latest().finish("Recovered reply"); });
    await press("New chat");
    await settle();
    expect(latest().frames.some((frame) => frame.method === "session.create")).toBe(true);
    expect(latest().conversation!.stored_session_id).not.toBe(a.stored_session_id);
    expect(ChatTestSocket.conversations.get(a.stored_session_id)?.messages.at(-1)?.text).toBe("Recovered reply");
    const freshId = latest().conversation!.stored_session_id;
    await input(composer(), "Draft for the new conversation");
    const chooseTab = async (id: string) => {
      await act(async () => {
        const tab = tabButtons().find((node) => node.dataset.sessionId === id);
        if (!tab) throw new Error("Missing conversation tab: " + id);
        tab.click();
      });
      await settle();
    };
    await chooseTab(a.stored_session_id);
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Recovered reply");
    expect(composer().value).toBe("Possibly accepted");
    await chooseTab(freshId);
    expect(composer().value).toBe("Draft for the new conversation");
  });

  it("opens tabs from the header picker only after a choice and excludes occupied conversations from both pickers", async () => {
    const history = seedSession("history", "Existing discussion");
    seedSession("other", "Another discussion");
    app = await mountEditor(<WebChatPage />, undefined, true);
    await settle();
    const originalId = latest().conversation!.stored_session_id;
    await input(composer(), "Original discussion");
    await press("Send");
    await act(async () => {
      latest().event("session.info", { title: "Original discussion" });
      latest().finish("Original reply");
    });
    const originalTab = activeTab();
    const socketCount = ChatTestSocket.instances.length;
    expect(originalTab.closest('[role="banner"]')).not.toBeNull();

    await press("Open conversation tab");
    expect(tabButtons()).toHaveLength(1);
    expect(ChatTestSocket.instances).toHaveLength(socketCount);
    expect(tabMenu().querySelector('[data-session-id="' + originalId + '"]')).toBeNull();
    const historyOption = tabMenu().querySelector<HTMLButtonElement>('[data-session-id="history"]')!;
    expect(historyOption.textContent).toContain("2 msgs");
    expect(historyOption.textContent).toContain("gui");
    await act(async () => { historyOption.click(); });
    await settle();
    expect(tabButtons().map((tab) => tab.dataset.sessionId)).toEqual([originalId, history.stored_session_id]);
    expect(activeTab().textContent).toBe("Existing discussion");
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Reply to Existing discussion");
    expect(latest().frames.find((frame) => frame.method === "session.resume")?.params?.session_id).toBe(history.stored_session_id);

    await press("Open conversation tab");
    expect(tabMenu().querySelector('[data-session-id="history"]')).toBeNull();
    await act(async () => { tabMenu().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(tabMenu()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Open conversation tab");

    await press("Open conversation tab");
    await press("New chat", tabMenu());
    await settle();
    expect(activeTab().textContent).toBe("Untitled");
    expect(tabButtons().map((tab) => tab.textContent)).toEqual(["Original discussion", "Existing discussion", "Untitled"]);
    const newId = latest().conversation!.stored_session_id;
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="group"][aria-label="Switch conversation"] [role="combobox"]')!.click();
    });
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.some((option) => option.textContent?.startsWith("Original discussion"))).toBe(false);
    expect(options.some((option) => option.textContent?.startsWith("Existing discussion"))).toBe(false);
    expect(options.some((option) => option.textContent?.startsWith("Another discussion"))).toBe(true);
    expect(options.some((option) => option.getAttribute("aria-selected") === "true")).toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

    await press("Close tab: Original discussion");
    expect(activeTab().dataset.sessionId).toBe(newId);
    expect(ChatTestSocket.conversations.has(originalId)).toBe(true);
    await press("Open conversation tab");
    expect(tabMenu().querySelector('[data-session-id="' + originalId + '"]')).not.toBeNull();
    expect(tabMenu().querySelector('[data-session-id="' + newId + '"]')).toBeNull();
    await act(async () => { tabMenu().querySelector<HTMLButtonElement>('[data-session-id="' + originalId + '"]')!.click(); });
    await settle();
    expect(activeTab().dataset.sessionId).toBe(originalId);
    await act(async () => { activeTab().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    await settle();
    expect(activeTab().dataset.sessionId).toBe(newId);
    expect(document.activeElement).toBe(activeTab());
    await press("Close tab: Untitled");
    await settle();
    expect(activeTab().dataset.sessionId).toBe(history.stored_session_id);
    await press("Close tab: Existing discussion");
    await settle();
    expect(activeTab().dataset.sessionId).toBe(originalId);
    expect(tabButtons()).toHaveLength(1);
    expect(document.querySelector('[aria-label^="Close tab:"]')).toBeNull();
    expect(ChatTestSocket.conversations.has(history.stored_session_id)).toBe(true);
  });

  it("commits successful tab changes atomically and preserves background requests, drafts and delayed acknowledgements", async () => {
    const history = seedSession("history", "Existing discussion");
    app = await mountEditor(<WebChatPage />, undefined, true);
    await settle();
    const original = latest().conversation!;
    await input(composer(), "Repeated question");
    await press("Send");
    await act(async () => { latest().finish("Original reply"); });
    await input(composer(), "Repeated question");
    const sendFrame = ChatTestSocket.prototype.send;
    let held: { socket: ChatTestSocket; id: string } | undefined;
    const hold = vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function (this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.resume" && frame.params.session_id === history.stored_session_id) {
        this.frames.push(frame);
        held = { socket: this, id: frame.id };
      } else sendFrame.call(this, text);
    });

    await press("Open conversation tab");
    await act(async () => { tabMenu().querySelector<HTMLButtonElement>('[data-session-id="history"]')!.click(); });
    await settle();
    expect(held).toBeDefined();
    expect(tabButtons()).toHaveLength(1);
    expect(activeTab().dataset.sessionId).toBe(original.stored_session_id);
    const socketCount = ChatTestSocket.instances.length;
    await press("Open conversation tab");
    await press("New chat");
    expect(ChatTestSocket.instances).toHaveLength(socketCount);
    await act(async () => { held!.socket.receive({ id: held!.id, error: { code: 4007, message: "Resume refused" } }); });
    await settle();
    expect(tabButtons()).toHaveLength(1);
    expect(activeTab().dataset.sessionId).toBe(original.stored_session_id);
    expect(composer().value).toBe("Repeated question");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Resume refused");
    hold.mockRestore();
    await press("Reconnect");
    expect(composer().value).toBe("Repeated question");
    await press("Open conversation tab");
    await act(async () => { tabMenu().querySelector<HTMLButtonElement>('[data-session-id="history"]')!.click(); });
    await settle();
    expect(tabButtons()).toHaveLength(2);
    await input(composer(), "History draft");
    await act(async () => {
      latest().event("message.start");
      latest().request("pending", "approval", { command: "continue", choices: ["once", "deny"] });
    });
    const resumeCount = ChatTestSocket.instances.flatMap(socket => socket.frames.filter(frame => frame.method === "session.resume")).length;
    await act(async () => { tabButtons().find(tab => tab.dataset.sessionId === original.stored_session_id)!.click(); });
    expect(activeTab().dataset.sessionId).toBe(original.stored_session_id);
    expect(document.body.textContent).not.toContain("Approval required");
    expect(composer().value).toBe("Repeated question");
    expect(ChatTestSocket.instances.flatMap(socket => socket.frames.filter(frame => frame.method === "session.resume"))).toHaveLength(resumeCount);
    await act(async () => { tabButtons().find(tab => tab.dataset.sessionId === history.stored_session_id)!.click(); });
    expect(composer().value).toBe("History draft");
    expect(document.body.textContent).toContain("Approval required");
    await press("Allow once");
    expect(prompts()).toHaveLength(1);
    expect(latest().frames.find((frame) => frame.method === "session.resume")?.params?.close_on_disconnect).toBe(false);
    await act(async () => { latest().finish("History reply"); });
    let promptAck: { socket: ChatTestSocket; id: string } | undefined;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function (this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "prompt.submit") {
        this.frames.push(frame);
        promptAck = { socket: this, id: frame.id };
      } else sendFrame.call(this, text);
    });
    await press("Send");
    expect(promptAck).toBeDefined();
    await press("Open conversation tab");
    await act(async () => { tabButtons().find((tab) => tab.dataset.sessionId === original.stored_session_id)!.click(); });
    expect(tabMenu()).toBeNull();
    expect(activeTab().dataset.sessionId).toBe(original.stored_session_id);
    expect(composer().value).toBe("Repeated question");
    await act(async () => {
      promptAck!.socket.receive({ id: promptAck!.id, result: { status: "streaming" } });
    });
    expect(composer().value).toBe("Repeated question");
    await act(async () => { tabButtons().find(tab => tab.dataset.sessionId === history.stored_session_id)!.click(); });
    expect(composer().value).toBe("");
    expect(tabButtons().find((tab) => tab.dataset.sessionId === original.stored_session_id)!.disabled).toBe(false);
  });

  it("aggregates hidden drafts in the leave guard and keeps the workspace when departure is cancelled", async () => {
    app = await mountEditor(<WebChatPage />, undefined, true); await settle();
    await input(composer(), "Protected draft");
    await press("New chat"); await settle();
    const count = ChatTestSocket.instances.length;
    await press("Switch profile");
    expect(document.body.textContent).toContain("Discard unsaved changes?");
    await press("Keep editing");
    expect(ChatTestSocket.instances).toHaveLength(count);
    expect(tabButtons()).toHaveLength(2);
    await act(async () => { tabButtons()[0].click(); });
    expect(composer().value).toBe("Protected draft");
    await press("Switch profile"); await press("Discard and continue"); await settle();
    expect(latest().conversation!.info.profile_name).toBe("B");
    expect(composer().value).toBe("");
    expect(ChatTestSocket.instances[count - 1].readyState).toBe(3);
  });

  it("retains four tabs, drafts, images and view state across route departure while background requests keep working", async () => {
    const revoked: string[] = [];
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL() { return "blob:retained-draft"; }
      static revokeObjectURL(url: string) { revoked.push(url); }
    });
    app = await mountEditor(<WebChatPage />, undefined, true); await settle();
    const first = latest().conversation!;
    await input(composer(), "First tab draft");
    for (let i = 0; i < 3; i++) { await press("New chat"); await settle(); }
    const last = latest().conversation!;
    await input(composer(), "Question in fourth tab"); await press("Send");
    await act(async () => {
      latest().event("reasoning.delta", { text: "Preserved reasoning" }, last.session_id);
      latest().finish("Fourth tab answer", "complete", last.session_id);
    });
    await input(composer(), "Fourth tab draft");
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, "files", { configurable: true, value: [new File(["x"], "retained.png", { type: "image/png" })] });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
    const detail = document.querySelector<HTMLDetailsElement>('details[data-chat-detail]')!;
    expect(detail).not.toBeNull();
    await act(async () => { detail.open = true; detail.dispatchEvent(new Event("toggle")); });
    const scroll = document.querySelector<HTMLDivElement>(".overflow-y-auto.overscroll-contain")!;
    Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 300 } });
    await act(async () => { scroll.scrollTop = 123; scroll.dispatchEvent(new Event("scroll", { bubbles: true })); composer().setSelectionRange(4, 4); });
    const ids = tabButtons().map(tab => tab.dataset.sessionId);
    const before = latest().frames.filter(frame => ["session.resume", "session.activate", "session.create"].includes(frame.method || "")).length;
    await press("Leave editor"); await settle();
    expect(document.body.textContent).toContain("Other page");
    expect(document.body.textContent).not.toContain("Discard unsaved changes?");
    expect(tabButtons()).toHaveLength(0); expect(composer()).toBeNull();
    expect(latest().readyState).toBe(1); expect(revoked).toHaveLength(0);
    expect(unloadPrevented()).toBe(true);
    await act(async () => {
      latest().event("message.start", {}, first.session_id);
      latest().finish("Arrived while viewing files", "complete", first.session_id);
      latest().request("route-approval", "approval", { session_id: first.session_id, command: "Background approval", choices: ["once", "deny"] });
      await app!.router.navigate("/edit");
    });
    await settle();
    // View restoration is scheduled after the recreated DOM has been committed.
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(ChatTestSocket.instances).toHaveLength(1);
    expect(tabButtons().map(tab => tab.dataset.sessionId)).toEqual(ids);
    expect(activeTab().dataset.sessionId).toBe(last.stored_session_id);
    expect(composer().value).toBe("Fourth tab draft"); expect(composer().selectionStart).toBe(4);
    expect(document.querySelector<HTMLDivElement>(".overflow-y-auto.overscroll-contain")!.scrollTop).toBe(123);
    expect(document.querySelector<HTMLDetailsElement>('details[data-chat-detail]')!.open).toBe(true);
    expect(document.querySelector('img[src="blob:retained-draft"]')).not.toBeNull();
    expect(latest().frames.filter(frame => ["session.resume", "session.activate", "session.create"].includes(frame.method || ""))).toHaveLength(before);
    await act(async () => { tabButtons()[0].click(); }); await settle();
    expect(composer().value).toBe("First tab draft");
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Arrived while viewing files");
    expect(document.body.textContent).toContain("Background approval");
    await press("Deny");
    expect(latest().frames.find(frame => frame.id === "route-approval")?.result).toEqual({ choice: "deny" });
    await press("Leave editor"); await settle();
    await press("Switch profile");
    expect(document.body.textContent).toContain("Discard unsaved changes?");
    await press("Keep editing"); expect(latest().readyState).toBe(1);
    await press("Switch profile"); await press("Discard and continue"); await settle();
    expect(ChatTestSocket.instances).toHaveLength(1); expect(latest().readyState).toBe(3);
    expect(revoked).toEqual(["blob:retained-draft"]);
    await act(async () => { await app!.router.navigate("/edit"); }); await settle();
    expect(ChatTestSocket.instances).toHaveLength(2); expect(tabButtons()).toHaveLength(1);
    expect(composer().value).toBe(""); expect(latest().conversation!.info.profile_name).toBe("B");
  });

  it("lazily restores only scoped tab identities after reload with bounded attachment concurrency and retryable failures", async () => {
    app = await mountEditor(<WebChatPage />, ["/other?profile=A"], true); await settle();
    expect(ChatTestSocket.instances).toHaveLength(0);
    await act(async () => { await app!.router.navigate("/edit?profile=A"); }); await settle();
    for (let i = 0; i < 3; i++) { await press("New chat"); await settle(); }
    const ids = tabButtons().map(tab => tab.dataset.sessionId!);
    await act(async () => { tabButtons()[1].click(); }); await settle();
    await input(composer(), "Memory-only draft");
    const key = Object.keys(sessionStorage).find(key => key.endsWith(":A:tabs:v1"))!;
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ version: 1, sessions: ids, activeSessionId: ids[1] });
    expect(Object.values(sessionStorage).join(" ")).not.toContain("Memory-only draft");
    await app.unmount(); app = undefined;
    // Duplicate identities are sanitized; a deleted conversation remains an explicit local error.
    sessionStorage.setItem(key, JSON.stringify({ version: 1, sessions: [ids[0], "deleted", ...ids.slice(1), ids[0]], activeSessionId: ids[1] }));
    const send = ChatTestSocket.prototype.send;
    const held: Array<{ socket: ChatTestSocket; id: string; stored: string }> = [];
    let inflight = 0; let peak = 0;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.resume") {
        this.frames.push(frame); inflight++; peak = Math.max(peak, inflight);
        held.push({ socket: this, id: frame.id, stored: frame.params.session_id });
        if (frame.params.session_id === ids[0]) this.request("refresh-approval", "approval", {
          session_id: ChatTestSocket.conversations.get(ids[0])!.session_id, command: "Restored approval", choices: ["once", "deny"],
        });
      } else send.call(this, text);
    });
    app = await mountEditor(<WebChatPage />, undefined, true); await settle();
    expect(held).toHaveLength(2);
    expect(tabButtons().map(tab => tab.dataset.sessionId)).toEqual([ids[0], "deleted", ...ids.slice(1)]);
    expect(activeTab().dataset.sessionId).toBe(ids[1]);
    while (held.length) {
      const reply = held.shift()!; inflight--;
      const conversation = ChatTestSocket.conversations.get(reply.stored);
      await act(async () => {
        if (conversation) { reply.socket.conversation = conversation; reply.socket.attached.add(conversation.session_id); reply.socket.receive({ id: reply.id, result: conversation }); }
        else reply.socket.receive({ id: reply.id, error: { code: 4007, message: "session not found" } });
      });
      await settle();
    }
    expect(peak).toBeLessThanOrEqual(2);
    expect(ChatTestSocket.instances).toHaveLength(2);
    expect(latest().frames.filter(frame => frame.method === "session.create")).toHaveLength(0);
    expect(activeTab().dataset.sessionId).toBe(ids[1]); expect(composer().value).toBe("");
    await act(async () => { tabButtons()[0].click(); }); await settle();
    expect(document.body.textContent).toContain("Restored approval");
    await press("Deny");
    expect(latest().frames.find(frame => frame.id === "refresh-approval")?.result).toEqual({ choice: "deny" });
    await act(async () => { tabButtons()[1].click(); }); await settle();
    expect(activeTab().dataset.sessionId).toBe("deleted");
    // Selecting the failed tab retries its existing identity without creating a replacement.
    expect(held).toHaveLength(1);
    await act(async () => { const reply = held.shift()!; reply.socket.receive({ id: reply.id, error: { code: 4007, message: "session not found" } }); });
    await settle(); expect(document.querySelector('[role="alert"]')?.textContent).toContain("session not found");
    const persistence = webChatPersistence("A");
    const legacy = persistence.restore();
    for (const invalid of ["{", JSON.stringify({ version: 2, sessions: ids }), JSON.stringify({ version: 1, sessions: [42] })]) {
      sessionStorage.setItem(key, invalid);
      expect(persistence.restoreLayout!()).toBeNull(); expect(persistence.restore()).toBe(legacy);
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Storage blocked"); });
    expect(persistence.restoreLayout!()).toBeNull(); expect(persistence.restore()).toBeNull();

  });

});
