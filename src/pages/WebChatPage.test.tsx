// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebChatPage from "./WebChatPage";
import { ChatTestSocket } from "@/test/web-chat-server";
import { input, json, mountEditor, press, profileResponse, setupEditorDOM } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>> | undefined;
let tickets: number;
const latest = () => ChatTestSocket.instances.at(-1)!;
const composer = () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message Hermes…"]')!;
const prompts = () => ChatTestSocket.instances.flatMap((socket) => socket.frames.filter((frame) => frame.method === "prompt.submit"));
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

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
    const chooseSession = async (id: string) => {
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[role="group"][aria-label="Switch conversation"] [role="combobox"]')!.click();
      });
      await act(async () => {
        const label = ChatTestSocket.conversations.get(id)?.messages[0]?.text ?? "New chat";
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
          .find((node) => node.textContent?.split("\n")[0] === label);
        if (!option) throw new Error("Missing conversation option: " + id);
        expect(option.textContent).toContain("gui");
        expect(option.textContent).toContain(ChatTestSocket.conversations.get(id)!.messages.length + " msgs");
        option.click();
      });
      await settle();
    };
    await chooseSession(a.stored_session_id);
    expect(document.querySelector('[role="log"]')?.textContent).toContain("Recovered reply");
    expect(composer().value).toBe("");
    await chooseSession(freshId);
    expect(composer().value).toBe("Draft for the new conversation");
  });
});
