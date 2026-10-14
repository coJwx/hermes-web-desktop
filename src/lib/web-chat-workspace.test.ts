// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebChatWorkspace } from "./web-chat-workspace";
import { ChatTestSocket } from "@/test/web-chat-server";

let workspace: WebChatWorkspace;
const socket = () => ChatTestSocket.instances.at(-1)!;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const active = () => workspace.getSnapshot().controller;
const methods = () => ChatTestSocket.instances.flatMap(s => s.frames.filter(frame => frame.method).map(frame => frame.method));
beforeEach(() => {
  ChatTestSocket.reset(); vi.stubGlobal("WebSocket", ChatTestSocket);
  window.__HERMES_SESSION_TOKEN__ = "wire-test"; window.__HERMES_AUTH_REQUIRED__ = false;
  workspace = new WebChatWorkspace({ profile: "test", restore: () => null, remember: () => {} });
});
afterEach(() => { workspace.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete window.__HERMES_SESSION_TOKEN__; });

describe("single channel conversation workspace", () => {
  it("switches five cached sessions 100 times without any network work and isolates background events and operations", async () => {
    await workspace.start();
    for (let i = 0; i < 4; i++) await workspace.open();
    const tabs = workspace.getSnapshot().tabs;
    const before = methods().length;
    for (let i = 0; i < 100; i++) await workspace.select(tabs[i % 5].id);
    expect(methods()).toHaveLength(before); expect(ChatTestSocket.instances).toHaveLength(1);
    await workspace.select(tabs[0].id); const a = active(); const aid = a.getSnapshot().sessionId!;
    await a.submit("A asks");
    await workspace.select(tabs[1].id); const b = active(); const bid = b.getSnapshot().sessionId!;
    await b.submit("B asks");
    socket().event("message.delta", { text: "A output" }, aid);
    socket().event("message.delta", { text: "B output" }, bid);
    expect(a.getSnapshot().messages.at(-1)?.text).toBe("A output");
    expect(b.getSnapshot().messages.at(-1)?.text).toBe("B output");
    socket().request("a-request", "approval", { session_id: aid, command: "A approval", choices: ["once", "deny"] });
    expect(a.getSnapshot().requests).toHaveLength(1); expect(b.getSnapshot().requests).toHaveLength(0);
    expect(workspace.getSnapshot().tabs.find(tab => tab.id === tabs[0].id)?.waiting).toBe(true);
    expect(await workspace.close(tabs[0].id)).toBe(true);
    expect(workspace.getSnapshot().background).toHaveLength(1);
    expect(socket().frames.some(frame => ["session.close", "session.delete", "session.interrupt"].includes(frame.method!))).toBe(false);
    await workspace.reopen(tabs[0].id);
    a.respond(a.getSnapshot().requests[0], { choice: "deny" });
    expect(socket().frames.find(frame => frame.id === "a-request")?.result).toEqual({ choice: "deny" });
    socket().finish("A final", "complete", aid); socket().finish("B final", "complete", bid);
  });

  it("keeps a delayed submission bound to its source while viewing another tab and refuses closing its transaction", async () => {
    await workspace.start(); const a = active(); const tabA = workspace.getSnapshot().activeTabId;
    await workspace.open(); const tabB = workspace.getSnapshot().activeTabId;
    const send = ChatTestSocket.prototype.send; let held: { id: string; socket: ChatTestSocket } | undefined;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "prompt.submit") { this.frames.push(frame); held = { id: frame.id, socket: this }; }
      else send.call(this, text);
    });
    await workspace.select(tabA); const result = a.submit("Source draft"); await flush();
    expect(await workspace.close(tabA)).toBe(false);
    await workspace.select(tabB); expect(active().getSnapshot().messages).toHaveLength(0);
    held!.socket.receive({ id: held!.id, result: { status: "streaming" } });
    expect(await result).toBe(true); expect(active().getSnapshot().messages).toHaveLength(0);
    expect(a.getSnapshot().messages[0].text).toBe("Source draft");
  });

  it("assigns pre-attachment requests and retains a late successful open without stealing selection", async () => {
    await workspace.start(); const first = workspace.getSnapshot().activeTabId;
    await workspace.open();
    const conversation = { session_id: "runtime-history", stored_session_id: "history", messages: [], info: { model: "test", profile_name: "test" }, running: false,
      open_requests: [{ id: "pre-attach", method: "clarify", params: { session_id: "runtime-history", question: "Choose?" } }] };
    ChatTestSocket.conversations.set("history", conversation);
    const send = ChatTestSocket.prototype.send; let held: { id: string; socket: ChatTestSocket } | undefined;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.resume") { this.frames.push(frame); held = { id: frame.id, socket: this }; }
      else send.call(this, text);
    });
    const opening = workspace.open("history"); await flush();
    await workspace.select(first);
    held!.socket.receive({ id: held!.id, result: conversation });
    expect(await opening).toBe(true); expect(workspace.getSnapshot().activeTabId).toBe(first);
    const history = workspace.getSnapshot().tabs.find(tab => tab.storedSessionId === "history")!;
    expect(history.waiting).toBe(true);
    expect(socket().frames.find(frame => frame.id === "pre-attach")?.error).toBeUndefined();
    await workspace.select(history.id);
    expect(active().getSnapshot().requests[0].method).toBe("clarify");
  });

  it("deduplicates continuous replay and a concurrent live event through the real channel", async () => {
    await workspace.start(); const a = active(); const sid = a.getSnapshot().sessionId!;
    await a.submit("question"); socket().event("message.delta", { text: "A" }, sid);
    const old = socket(); old.close(); old.event("message.delta", { text: "B" }, sid);
    const send = ChatTestSocket.prototype.send;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.events.since") this.event("message.delta", { text: "C" }, sid);
      send.call(this, text);
    });
    await workspace.reconnect();
    expect(a.getSnapshot().messages.at(-1)?.text).toBe("ABC");
    expect(a.getSnapshot().busy).toBe(true);
    expect(ChatTestSocket.instances).toHaveLength(2);
    expect(methods().filter(method => method === "session.events.since")).toHaveLength(1);
    expect(methods().filter(method => method === "prompt.submit")).toHaveLength(1);
  });

  it("replaces untrusted inflight snapshots without appending their concurrent delta and preserves ambiguous submissions", async () => {
    await workspace.start(); const controller = active(); const tab = workspace.getSnapshot().activeTabId;
    const conversation = socket().conversation!;
    await controller.submit("same question"); socket().event("message.delta", { text: "A" });
    ChatTestSocket.replayTruncated = true;
    socket().close();
    const send = ChatTestSocket.prototype.send;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.activate" && !frame.params.omit_messages) {
        this.frames.push(frame); this.event("message.delta", { text: "X" }, conversation.session_id);
        queueMicrotask(() => this.receive({ id: frame.id, result: { ...conversation, inflight: { user: "same question", assistant: "AX" } } }));
      } else send.call(this, text);
    });
    await workspace.reconnect();
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("AX");
    expect(workspace.getSnapshot().tabs.find(t => t.id === tab)?.syncing).toBe(true);
    socket().finish("Final authoritative text", "complete", conversation.session_id);
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("Final authoritative text");
  });

  it("counts closed associations, promotes their requests and reclaims only an idle whole connection", async () => {
    await workspace.start(); const initial = workspace.getSnapshot().activeTabId; const sid = active().getSnapshot().sessionId!;
    for (let i = 0; i < 15; i++) await workspace.open();
    expect(workspace.getSnapshot().associations).toBe(16);
    await workspace.close(initial);
    expect(workspace.getSnapshot().associations).toBe(16);
    expect(await workspace.open()).toBe(false);
    socket().request("closed-approval", "approval", { session_id: sid, command: "another window" });
    expect(workspace.getSnapshot().background).toHaveLength(1);
    expect(await workspace.reclaim()).toBe(false);
    await workspace.reopen(initial); const controller = active();
    controller.respond(controller.getSnapshot().requests[0], { choice: "deny" });
    await workspace.close(initial);
    const count = ChatTestSocket.instances.length;
    expect(await workspace.reclaim()).toBe(true); expect(ChatTestSocket.instances).toHaveLength(count + 1);
    expect(workspace.getSnapshot().associations).toBe(15);
    expect(methods().some(method => ["session.close", "session.delete", "session.interrupt"].includes(method!))).toBe(false);
  });

  it("evicts full histories without reconstructing them from background tokens and trims oversized display rows", async () => {
    await workspace.start();
    let first: string | undefined;
    for (let n = 0; n < 9; n++) {
      const id = "history-" + n;
      ChatTestSocket.conversations.set(id, { session_id: "runtime-" + n, stored_session_id: id,
        messages: Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: id + " row " + i })),
        info: { model: "test", profile_name: "test" }, running: false });
      await workspace.open(id); expect(active().getSnapshot().messages).toHaveLength(100); first ??= workspace.getSnapshot().activeTabId;
    }
    expect(workspace.getDiagnostics().histories).toBeLessThanOrEqual(8);
    const evicted = workspace.getBinding(first!)!;
    expect(evicted.controller.getSnapshot().messages).toHaveLength(0);
    socket().event("message.start", {}, "runtime-0");
    for (let i = 0; i < 20; i++) socket().event("message.delta", { text: "x".repeat(20_000) }, "runtime-0");
    expect(evicted.controller.getSnapshot().messages).toHaveLength(0);
    expect(workspace.getDiagnostics().previewBytes).toBeLessThanOrEqual(256 * 1024);
    const current = active();
    current.patchState({ messages: [{ id: "huge", role: "assistant", text: "x".repeat(5 * 1024 ** 2) }], busy: true });
    expect(current.getSnapshot().historyTruncated).toBe(true);
    expect(workspace.getDiagnostics().historyBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
    expect(current.getSnapshot().messages[0].text.length * 2).toBeLessThanOrEqual(8 * 1024 ** 2);
  });

  it("recovers at most two sessions concurrently, resumes expired runtime IDs and keeps settling failures local", async () => {
    await workspace.start(); const a = active(); const storedA = a.getSnapshot().storedSessionId!;
    const oldA = a.getSnapshot().sessionId!;
    await workspace.open(); const b = active(); const runtimeB = b.getSnapshot().sessionId!;
    await workspace.open(); const c = active();
    ChatTestSocket.conversations.get(storedA)!.session_id = "new-runtime-A";
    socket().close();
    const send = ChatTestSocket.prototype.send;
    const held: Array<{ socket: ChatTestSocket; id: string; sid: string }> = [];
    let outstanding = 0; let maximum = 0;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.activate") {
        this.frames.push(frame); held.push({ socket: this, id: frame.id, sid: frame.params.session_id });
        maximum = Math.max(maximum, ++outstanding);
      } else send.call(this, text);
    });
    const restoring = workspace.reconnect(); await flush();
    expect(held).toHaveLength(2);
    while (held.length || outstanding) {
      const frame = held.shift();
      if (!frame) { await flush(); continue; }
      outstanding--;
      if (frame.sid === oldA) frame.socket.receive({ id: frame.id, error: { code: 4007, message: "expired runtime" } });
      else if (frame.sid === runtimeB) frame.socket.receive({ id: frame.id, error: { code: 4009, message: "settling" } });
      else {
        const conversation = [...ChatTestSocket.conversations.values()].find(row => row.session_id === frame.sid)!;
        frame.socket.receive({ id: frame.id, result: { ...conversation, messages_omitted: false } });
      }
      await flush();
    }
    await restoring;
    expect(maximum).toBeLessThanOrEqual(2);
    expect(a.getSnapshot().sessionId).toBe("new-runtime-A");
    expect(b.getSnapshot().error).toBe("settling"); expect(c.getSnapshot().error).toBeNull();
    expect(ChatTestSocket.instances).toHaveLength(2);
    socket().event("message.delta", { text: "stale" }, oldA);
    expect(a.getSnapshot().messages.some(row => row.text.includes("stale"))).toBe(false);
    expect(workspace.getSnapshot().compatibility).toBe(false);
  });

  it("replaces stale request responders after disconnect and exposes only a missing attach method as compatibility", async () => {
    await workspace.start(); const controller = active();
    const conversation = socket().conversation!;
    conversation.open_requests = [{ id: "approval", method: "approval", params: { session_id: conversation.session_id, command: "continue" } }];
    socket().request("approval", "approval"); const stale = controller.getSnapshot().requests[0];
    socket().close();
    expect(controller.canRespond(stale)).toBe(false);
    const send = ChatTestSocket.prototype.send;
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "session.activate") { this.frames.push(frame); queueMicrotask(() => this.receive({ id: frame.id, error: { code: -32601, message: "method missing" } })); }
      else send.call(this, text);
    });
    await workspace.reconnect();
    expect(workspace.getSnapshot().compatibility).toBe(true);
    const restored = controller.getSnapshot().requests[0];
    expect(restored).not.toBe(stale); expect(controller.canRespond(stale)).toBe(false);
    controller.respond(stale, { choice: "once" });
    expect(socket().frames.find(frame => frame.id === "approval")).toBeUndefined();
    controller.respond(restored, { choice: "deny" });
    expect(socket().frames.find(frame => frame.id === "approval")?.result).toEqual({ choice: "deny" });
  });


  it("retains a lost create reservation, does not retry it and refuses reclaiming another running session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    await workspace.start(); const running = active(); const sid = running.getSnapshot().sessionId!;
    await running.submit("keep running");
    const send = ChatTestSocket.prototype.send; const receive = ChatTestSocket.prototype.receive; let lostId = "";
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text); if (frame.method === "session.create") lostId = frame.id;
      send.call(this, text);
    });
    vi.spyOn(ChatTestSocket.prototype, "receive").mockImplementation(function(this: ChatTestSocket, frame) {
      if (frame.id === lostId && lostId) return;
      receive.call(this, frame);
    });
    const opening = workspace.open(); await flush();
    await vi.advanceTimersByTimeAsync(120_001); expect(await opening).toBe(false);
    const creates = methods().filter(method => method === "session.create").length;
    expect(workspace.getSnapshot().associations).toBe(2);
    expect(await workspace.open()).toBe(false); expect(await workspace.reclaim()).toBe(false);
    expect(ChatTestSocket.instances).toHaveLength(1);
    socket().finish("Done", "complete", sid);
    expect(await workspace.reclaim()).toBe(true);
    expect(methods().filter(method => method === "session.create")).toHaveLength(creates);
    expect(workspace.getSnapshot().associations).toBe(1);
  });

  it("polls cold running state only in the visible selected view and stops every workspace timer on disposal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await workspace.start(); const first = workspace.getSnapshot().activeTabId;
    const conversation = { session_id: "cold-runtime", stored_session_id: "cold-stored", messages: [{ role: "user", text: "Working" }],
      info: { model: "test", profile_name: "test" }, running: true, inflight: { user: "Working", assistant: "Snapshot" } };
    ChatTestSocket.conversations.set("cold-stored", conversation); await workspace.open("cold-stored");
    const target = workspace.getSnapshot().activeTabId;
    const count = () => methods().filter(method => method === "session.activate").length;
    await vi.advanceTimersByTimeAsync(3000); expect(count()).toBe(3);
    await workspace.select(first); const before = count();
    await vi.advanceTimersByTimeAsync(3000); expect(count()).toBe(before);
    await workspace.select(target);
    workspace.setViewActive(false);
    await vi.advanceTimersByTimeAsync(3000); expect(count()).toBe(before);
    expect(socket().readyState).toBe(1);
    socket().request("away-request", "approval", { session_id: conversation.session_id, command: "Still reachable" });
    expect(active().getSnapshot().requests).toHaveLength(1);
    workspace.setViewActive(true);
    await vi.advanceTimersByTimeAsync(1000); expect(count()).toBe(before + 1);
    const afterReturn = count();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await vi.advanceTimersByTimeAsync(3000); expect(count()).toBe(afterReturn);
    workspace.stop(); expect(vi.getTimerCount()).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });


  it("keeps a delayed model confirmation and image upload on their originating runtime while another view is active", async () => {
    await workspace.start(); const a = active(); const aid = a.getSnapshot().sessionId!; const tabA = workspace.getSnapshot().activeTabId;
    await workspace.open(); const b = active(); const tabB = workspace.getSnapshot().activeTabId;
    const send = ChatTestSocket.prototype.send; let configId = "";
    vi.spyOn(ChatTestSocket.prototype, "send").mockImplementation(function(this: ChatTestSocket, text: string) {
      const frame = JSON.parse(text);
      if (frame.method === "config.set") { this.frames.push(frame); configId = frame.id; }
      else send.call(this, text);
    });
    await workspace.select(tabA); const model = a.switchModel("provider", "expensive-model"); await flush();
    await workspace.select(tabB);
    socket().receive({ id: configId, result: { key: "model", value: "expensive-model", confirm_required: true, confirm_message: "Confirm expense" } });
    await model;
    expect(a.getSnapshot().modelConfirmation).toMatchObject({ sessionId: aid, model: "expensive-model" });
    expect(b.getSnapshot().modelConfirmation).toBeNull(); expect(await workspace.close(tabA)).toBe(false);
    a.patchState({ modelConfirmation: null });
    let resolveUpload!: (response: Response) => void;
    const upload = vi.fn((_url: string, _options?: RequestInit) => new Promise<Response>(resolve => { resolveUpload = resolve; }));
    vi.stubGlobal("fetch", upload);
    await workspace.select(tabA);
    const sending = a.submit("Image source", [new File(["x"], "image.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
    await workspace.select(tabB); expect(await workspace.close(tabA)).toBe(false);
    resolveUpload(new Response(JSON.stringify({ path: "/images/test.png", name: "image.png", bytes: 1, mime_type: "image/png" }), { headers: { "Content-Type": "application/json" } }));
    expect(await sending).toBe(true);
    expect(upload.mock.calls[0][0]).toContain("profile=test");
    expect(socket().frames.find(frame => frame.method === "image.attach")?.params?.session_id).toBe(aid);
    expect(socket().frames.find(frame => frame.method === "prompt.submit")?.params?.session_id).toBe(aid);
    expect(b.getSnapshot().messages).toHaveLength(0);
  });

  it("preserves every control request at the high water mark and pauses new work without auto-responding", async () => {
    await workspace.start(); const controller = active();
    for (let i = 0; i < 129; i++) socket().request("control-" + i, "approval", { command: "Review " + i });
    expect(controller.getSnapshot().requests).toHaveLength(129);
    expect(workspace.getSnapshot().newWorkPaused).toBe(true);
    expect(await controller.submit("New work")).toBe(false); expect(await workspace.open()).toBe(false);
    expect(socket().frames.some(frame => frame.id?.startsWith("control-"))).toBe(false);
    controller.respond(controller.getSnapshot().requests[0], { choice: "deny" });
    controller.respond(controller.getSnapshot().requests[0], { choice: "deny" });
    expect(controller.getSnapshot().requests).toHaveLength(127);
    expect(workspace.getSnapshot().newWorkPaused).toBe(false);
    expect(socket().frames.filter(frame => frame.id?.startsWith("control-"))).toHaveLength(2);
  });


  it("resumes the stored identity after an epoch change rather than trusting the old runtime or sequence", async () => {
    await workspace.start(); const controller = active(); const stored = controller.getSnapshot().storedSessionId!;
    await controller.submit("Before restart"); socket().event("message.delta", { text: "old epoch" });
    socket().close(); ChatTestSocket.epoch = "replacement-process";
    const conversation = ChatTestSocket.conversations.get(stored)!;
    conversation.session_id = "replacement-runtime"; conversation.running = false;
    conversation.messages.push({ role: "assistant", text: "Authoritative recovery" });
    const before = methods().length; await workspace.reconnect();
    const recovery = methods().slice(before);
    expect(recovery).toContain("session.resume"); expect(recovery).not.toContain("session.activate"); expect(recovery).not.toContain("session.events.since");
    expect(controller.getSnapshot().sessionId).toBe("replacement-runtime");
    expect(controller.getSnapshot().messages.at(-1)?.text).toBe("Authoritative recovery");
    expect(controller.getSnapshot().busy).toBe(false);
  });

});
