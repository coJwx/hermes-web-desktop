// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebChatWorkspace } from "./web-chat-workspace";
import { ChatTestSocket } from "@/test/web-chat-server";
import { api } from "./api";

let workspace: WebChatWorkspace;
beforeEach(() => {
  ChatTestSocket.reset(); vi.stubGlobal("WebSocket", ChatTestSocket);
  window.__HERMES_SESSION_TOKEN__ = "transcript-test"; window.__HERMES_AUTH_REQUIRED__ = false;
  vi.spyOn(api, "getSessionDetail").mockResolvedValue({} as Awaited<ReturnType<typeof api.getSessionDetail>>);
  workspace = new WebChatWorkspace({ profile: "test", restore: () => null, remember: () => {} });
});
afterEach(() => { workspace.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete window.__HERMES_SESSION_TOKEN__; });

it("retains tool output and identity when a compact snapshot omits the result", async () => {
  await workspace.start();
  const controller = workspace.getSnapshot().controller;
  const socket = ChatTestSocket.instances.at(-1)!;
  socket.event("tool.start", { tool_id: "call-1", name: "terminal", args: { command: "pwd" } });
  socket.event("tool.complete", { tool_id: "call-1", name: "terminal", result_text: "/project", result: { exit_code: 1 }, duration_s: 1.2 });
  const before = controller.getSnapshot();
  const tool = before.messages.find(row => row.role === "tool")!;
  controller.restoreSnapshot({ session_id: before.sessionId!, stored_session_id: before.storedSessionId!, info: before.info, message_count: 1,
    messages: [{ role: "tool", tool_call_id: "call-1", name: "terminal", args: { command: "pwd" } }] });
  expect(controller.getSnapshot().messages[0]).toMatchObject({ id: tool.id, text: "/project", status: "error", durationSeconds: 1.2 });
  socket.event("tool.complete", { tool_id: "call-1", name: "terminal", summary: "Finished" });
  expect(controller.getSnapshot().messages[0]).toMatchObject({ id: tool.id, text: "/project", status: "error", durationSeconds: 1.2 });
});

it("reuses the in-flight message identity while replacing the snapshot body", async () => {
  await workspace.start();
  const controller = workspace.getSnapshot().controller;
  const state = controller.getSnapshot();
  const snapshot = { session_id: state.sessionId!, stored_session_id: state.storedSessionId!, info: state.info,
    message_count: 1, messages: [{ role: "user", text: "Question", row_id: 1 }], running: true, turn_started_at: 100,
    inflight: { user: "Question", assistant: "A" } };
  controller.restoreSnapshot(snapshot);
  const first = controller.getSnapshot().messages.at(-1)!;
  controller.restoreSnapshot({ ...snapshot, inflight: { user: "Question", assistant: "AX" } });
  expect(controller.getSnapshot().messages.at(-1)).toMatchObject({ id: first.id, text: "AX" });
  controller.restoreSnapshot({ ...snapshot, turn_started_at: 200, inflight: { user: "Question", assistant: "New turn" } });
  expect(controller.getSnapshot().messages.at(-1)!.id).not.toBe(first.id);
});

it("renders cold tool lifecycles immediately and retains uncommitted calls only for the confirmed running turn", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  await workspace.start();
  const conversation = { session_id: "cold-runtime", stored_session_id: "cold-stored",
    messages: [{ role: "user", text: "Work", row_id: 1, tool_call_id: undefined as string | undefined }],
    info: { model: "test", profile_name: "test" }, running: true, turn_started_at: 100,
    inflight: { user: "Work", assistant: "Snapshot text" } };
  ChatTestSocket.conversations.set("cold-stored", conversation);
  await workspace.open("cold-stored");
  const controller = workspace.getSnapshot().controller;
  const socket = ChatTestSocket.instances.at(-1)!;
  const assistantId = controller.getSnapshot().messages.at(-1)!.id;
  socket.event("tool.start", { tool_id: "cold-call", name: "terminal" }, conversation.session_id);
  const toolId = controller.getSnapshot().messages.find(row => row.role === "tool")!.id;
  expect(controller.getSnapshot().messages.find(row => row.id === toolId)?.status).toBe("working");
  socket.event("tool.complete", { tool_id: "cold-call", name: "terminal", result_text: "Result" }, conversation.session_id);
  socket.event("message.delta", { text: "untrusted delta" }, conversation.session_id);
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().messages.find(row => row.id === toolId)).toMatchObject({ text: "Result", status: "complete" });
  expect(controller.getSnapshot().messages.at(-1)).toMatchObject({ id: assistantId, text: "Snapshot text" });
  conversation.messages.push({ role: "tool", text: "", row_id: 2, tool_call_id: "cold-call" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().messages.filter(row => row.role === "tool")).toHaveLength(1);
  expect(controller.getSnapshot().messages.find(row => row.role === "tool")).toMatchObject({ id: toolId, text: "Result" });
  controller.restoreSnapshot({ session_id: conversation.session_id, stored_session_id: conversation.stored_session_id, info: conversation.info,
    running: true, turn_started_at: 200, message_count: 2, messages: [
      { role: "user", row_id: 3, text: "Next turn" }, { role: "tool", row_id: 4, tool_call_id: "cold-call", name: "terminal" },
    ] });
  expect(controller.getSnapshot().messages.find(row => row.role === "tool")!.text).toBe("");
});

it("does not guess tool identity from names/arguments, ambiguous reused IDs or another conversation", async () => {
  await workspace.start();
  const controller = workspace.getSnapshot().controller;
  const socket = ChatTestSocket.instances.at(-1)!;
  socket.event("tool.start", { tool_id: "reused", name: "terminal", args: { command: "pwd" } });
  socket.event("tool.complete", { tool_id: "reused", name: "terminal", result_text: "First" });
  socket.event("tool.start", { tool_id: "reused", name: "terminal", args: { command: "pwd" } });
  socket.event("tool.complete", { tool_id: "reused", name: "terminal", result_text: "Second" });
  const state = controller.getSnapshot();
  expect(state.messages.filter(row => row.role === "tool").map(row => row.text)).toEqual(["First", "Second"]);
  expect(new Set(state.messages.map(row => row.id)).size).toBe(state.messages.length);
  controller.restoreSnapshot({ session_id: state.sessionId!, stored_session_id: state.storedSessionId!, info: state.info, message_count: 2,
    messages: [{ role: "tool", tool_call_id: "reused", name: "terminal" }, { role: "tool", tool_call_id: "reused", name: "terminal" }] });
  expect(controller.getSnapshot().messages.map(row => row.text)).toEqual(["", ""]);
  socket.event("tool.start", { tool_id: "identified", name: "terminal", args: { command: "pwd" } });
  socket.event("tool.complete", { tool_id: "identified", name: "terminal", result_text: "Known output" });
  controller.restoreSnapshot({ session_id: state.sessionId!, stored_session_id: state.storedSessionId!, info: state.info, message_count: 1,
    messages: [{ role: "tool", name: "terminal", args: { command: "pwd" } }] });
  expect(controller.getSnapshot().messages[0].text).toBe("");
  socket.event("tool.start", { tool_id: "identified", name: "terminal" });
  socket.event("tool.complete", { tool_id: "identified", name: "terminal", result_text: "Only this conversation" });
  controller.restoreSnapshot({ session_id: "other-runtime", stored_session_id: "other-stored", info: {}, message_count: 1,
    messages: [{ role: "tool", tool_call_id: "identified", name: "terminal", args: { command: "pwd" } }] });
  expect(controller.getSnapshot().messages[0].text).toBe("");
});

it("does not duplicate lifecycle events already represented by a cold snapshot", async () => {
  await workspace.start();
  const conversation = { session_id: "represented-runtime", stored_session_id: "represented-stored",
    messages: [{ role: "user", text: "Work", row_id: 1, tool_call_id: undefined as string | undefined },
      { role: "tool", text: "", row_id: 2, tool_call_id: "represented-call" }],
    info: { model: "test", profile_name: "test" }, running: true, turn_started_at: 100,
    inflight: { user: "Work", assistant: "Snapshot" } };
  ChatTestSocket.conversations.set(conversation.stored_session_id, conversation);
  await workspace.open(conversation.stored_session_id);
  const controller = workspace.getSnapshot().controller;
  const socket = ChatTestSocket.instances.at(-1)!;
  const toolId = controller.getSnapshot().messages.find(row => row.role === "tool")!.id;
  socket.event("tool.start", { tool_id: "represented-call", name: "terminal" }, conversation.session_id);
  socket.event("tool.complete", { tool_id: "represented-call", name: "terminal", result_text: "Recovered result" }, conversation.session_id);
  const tools = controller.getSnapshot().messages.filter(row => row.role === "tool");
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({ id: toolId, text: "Recovered result", status: "complete" });
});
