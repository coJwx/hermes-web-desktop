// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebChatPage from "./WebChatPage";
import { ChatTestSocket } from "@/test/web-chat-server";
import { input, json, mountEditor, press, profileResponse, setupEditorDOM } from "@/test/editor-test-utils";

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
  delete window.__HERMES_SESSION_TOKEN__;
  delete window.__HERMES_AUTH_REQUIRED__;
});

describe("Web Chat over the real JSON-RPC client", () => {
  it("streams scoped turns, answers human requests safely, and stops only at the terminal event", async () => {
    app = await mountEditor(<WebChatPage />);
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
    app = await mountEditor(<WebChatPage />);
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
    expect(composer().value).toBe("");
    await chooseTab(freshId);
    expect(composer().value).toBe("Draft for the new conversation");
  });

  it("opens tabs from the header picker only after a choice and excludes occupied conversations from both pickers", async () => {
    const history = seedSession("history", "Existing discussion");
    seedSession("other", "Another discussion");
    app = await mountEditor(<WebChatPage />);
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

  it("commits successful tab changes atomically, keeps drafts on failures, and blocks navigation while a request is pending", async () => {
    const history = seedSession("history", "Existing discussion");
    app = await mountEditor(<WebChatPage />);
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
    const resumeCount = ChatTestSocket.instances.flatMap((socket) => socket.frames.filter((frame) => frame.method === "session.resume")).length;
    await act(async () => { tabButtons().find((tab) => tab.dataset.sessionId === original.stored_session_id)!.click(); });
    await press("Open conversation tab");
    expect(tabMenu()).toBeNull();
    expect(activeTab().dataset.sessionId).toBe(history.stored_session_id);
    expect(ChatTestSocket.instances.flatMap((socket) => socket.frames.filter((frame) => frame.method === "session.resume"))).toHaveLength(resumeCount);
    await press("Allow once");
    await act(async () => { tabButtons().find((tab) => tab.dataset.sessionId === original.stored_session_id)!.click(); });
    await settle();
    expect(composer().value).toBe("Repeated question");
    await act(async () => { tabButtons().find((tab) => tab.dataset.sessionId === history.stored_session_id)!.click(); });
    await settle();
    expect(composer().value).toBe("History draft");
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
    expect(activeTab().dataset.sessionId).toBe(history.stored_session_id);
    await act(async () => {
      promptAck!.socket.receive({ id: promptAck!.id, result: { status: "streaming" } });
    });
    expect(composer().value).toBe("");
    expect(tabButtons().find((tab) => tab.dataset.sessionId === original.stored_session_id)!.disabled).toBe(false);
  });
});
