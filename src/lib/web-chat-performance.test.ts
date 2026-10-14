// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatTestSocket } from "@/test/web-chat-server";
import { WebChatWorkspace } from "./web-chat-workspace";
import { CHAT_LIMITS, ChatEventBuffer } from "./web-chat-cache";
import type { ChatMessage } from "./web-chat-state";

let workspace: WebChatWorkspace;
const socket = () => ChatTestSocket.instances.at(-1)!;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  ChatTestSocket.reset(); vi.stubGlobal("WebSocket", ChatTestSocket);
  window.__HERMES_SESSION_TOKEN__ = "performance-wire"; window.__HERMES_AUTH_REQUIRED__ = false;
  workspace = new WebChatWorkspace({ profile: "test", restore: () => null, remember: () => {} });
});
afterEach(() => { workspace.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete window.__HERMES_SESSION_TOKEN__; });

it("streams without serializing retained state or revisiting unrelated cached histories and request payloads", async () => {
  await workspace.start(); const first = workspace.getSnapshot().activeTabId;
  for (let i = 0; i < 4; i++) await workspace.open();
  let historyReads = 0; let requestReads = 0;
  const tabs = workspace.getSnapshot().tabs;
  for (const tab of tabs.slice(1)) {
    const messages: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({ id: "row-" + i, role: i % 2 ? "assistant" : "user",
      get text() { historyReads++; return "x".repeat(1024); } }));
    workspace.getBinding(tab.id)!.controller.patchState({ messages });
  }
  const other = workspace.getBinding(tabs[1].id)!;
  socket().request("background-approval", "approval", { session_id: other.controller.getSnapshot().sessionId, command: "Review" });
  const request = other.controller.getSnapshot().requests[0];
  const params = { ...request.params, get command() { requestReads++; return "Review"; } };
  other.controller.patchState({ requests: [{ ...request, params }] });
  await vi.advanceTimersByTimeAsync(101); await workspace.select(first);
  const active = workspace.getSnapshot().controller; await active.submit("Question");
  historyReads = requestReads = 0;
  const original = JSON.stringify; let applicationSerializations = 0;
  vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => {
    if (!value || typeof value !== "object" || !("jsonrpc" in value)) applicationSerializations++;
    return original(value, ...args);
  });
  const summaries = vi.fn(); workspace.subscribe(summaries);
  for (let i = 0; i < 100; i++) socket().event("message.delta", { text: "x" }, active.getSnapshot().sessionId!);
  await vi.advanceTimersByTimeAsync(20);
  expect(active.getSnapshot().messages.at(-1)?.text).toBe("x".repeat(100));
  expect(historyReads).toBe(0); expect(requestReads).toBe(0);
  expect(applicationSerializations).toBe(0); expect(summaries).not.toHaveBeenCalled();
  const diagnostics = workspace.getDiagnostics();
  expect(diagnostics.histories).toBe(5); expect(diagnostics.requestCount).toBe(1);
});

it("retires a closed live projection without losing background requests, sequence tracking or final state", async () => {
  await workspace.start(); const first = workspace.getSnapshot().activeTabId;
  const source = workspace.getSnapshot().controller; const sid = source.getSnapshot().sessionId!;
  await source.submit("Run in background"); socket().event("message.delta", { text: "Prefix" }, sid);
  await workspace.open();
  expect(await workspace.close(first)).toBe(true);
  expect(source.getSnapshot().messages).toHaveLength(0);
  const binding = workspace.getBinding(first)!;
  expect(binding.projection).toBe("refresh-required");
  for (let i = 0; i < 100; i++) socket().event("message.delta", { text: "Background token" }, sid);
  expect(binding.preview).toBe(""); expect(source.getSnapshot().messages).toHaveLength(0);
  expect(binding.appliedSeq).toBe(102);
  socket().request("closed-approval", "approval", { session_id: sid, command: "Continue?" });
  expect(workspace.getSnapshot().background[0].waiting).toBe(true);
  await workspace.reopen(first);
  expect(source.getSnapshot().requests[0].id).toBe("closed-approval");
  source.respond(source.getSnapshot().requests[0], { choice: "deny" });
  socket().finish("Authoritative final text", "complete", sid);
  expect(source.getSnapshot().messages.at(-1)?.text).toBe("Authoritative final text");
  expect(source.getSnapshot().busy).toBe(false);
  expect(socket().frames.some(frame => ["session.close", "session.delete", "session.interrupt"].includes(frame.method!))).toBe(false);
});


it("enforces a shared recovery buffer budget without rescanning other queues and releases drained bytes", async () => {
  await workspace.start(); const first = workspace.getSnapshot().activeTabId;
  const a = workspace.getBinding(first)!; const aid = a.controller.getSnapshot().sessionId!;
  await workspace.open(); const b = workspace.getBinding(workspace.getSnapshot().activeTabId)!;
  const bid = b.controller.getSnapshot().sessionId!;
  a.held = new ChatEventBuffer(); b.held = new ChatEventBuffer();
  let reads = 0;
  const event = { type: "message.delta" as const, session_id: aid, seq: 1,
    payload: { get text() { reads++; return "a".repeat(3 * 1024 ** 2); } } };
  expect(a.held.push(event, CHAT_LIMITS.bufferBytes)).toBe(true);
  reads = 0;
  socket().event("message.delta", { text: "b".repeat(3 * 1024 ** 2) }, bid);
  expect(b.projection).toBe("refresh-required"); expect(b.held.bytes).toBe(0);
  expect(workspace.getDiagnostics().bufferedBytes).toBe(a.held.bytes);
  expect(workspace.getDiagnostics().bufferedBytes).toBeLessThanOrEqual(CHAT_LIMITS.bufferBytes);
  expect(reads).toBe(0);
  const drained = a.held.drain(); expect(drained).toEqual([event]);
  expect(workspace.getDiagnostics().bufferedBytes).toBe(0);
  socket().event("message.delta", { text: "b".repeat(3 * 1024 ** 2) }, bid);
  expect(b.held.items).toHaveLength(1);
  b.held.clear(); expect(workspace.getDiagnostics().bufferedBytes).toBe(0);
});


it("transfers replaced pre-attachment requests once and releases the request byte budget on cancellation", async () => {
  await workspace.start();
  const conversation = { session_id: "pending-runtime", stored_session_id: "pending-stored", messages: [],
    info: { model: "test", profile_name: "test" }, running: false };
  ChatTestSocket.conversations.set(conversation.stored_session_id, conversation);
  const send = ChatTestSocket.prototype.send; let ack = "";
  vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
    const frame = JSON.parse(text);
    if (frame.method === "session.resume") { this.frames.push(frame); ack = frame.id; }
    else send.call(this, text);
  });
  const opening = workspace.open(conversation.stored_session_id);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  socket().request("pre-attach", "clarify", { session_id: conversation.session_id, question: "x".repeat(1024 ** 2) });
  expect(workspace.getSnapshot().newWorkPaused).toBe(true); expect(workspace.getDiagnostics().requestCount).toBe(1);
  socket().request("pre-attach", "clarify", { session_id: conversation.session_id, question: "Small replacement" });
  expect(workspace.getSnapshot().newWorkPaused).toBe(false); expect(workspace.getDiagnostics().requestCount).toBe(1);
  socket().receive({ id: ack, result: { ...conversation, open_requests: [{ id: "pre-attach", method: "clarify", params: { session_id: conversation.session_id, question: "Small replacement" } }] } });
  expect(await opening).toBe(true); expect(workspace.getDiagnostics().requestCount).toBe(1);
  socket().event("request.cancel", { id: "pre-attach" }, conversation.session_id);
  expect(workspace.getDiagnostics().requestCount).toBe(0); expect(workspace.getSnapshot().newWorkPaused).toBe(false);
});
