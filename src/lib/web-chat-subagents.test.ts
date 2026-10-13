import { beforeEach, describe, expect, it, vi } from "vitest";
import { JsonRpcGatewayError, type SubagentEventPayload, type SubagentListResult } from "@hermes/shared";
import { applySubagentEvent, reconcileSubagentSnapshot, subagentFinished } from "./web-chat-subagents";
import { WebChatController } from "./web-chat-controller";

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  events: new Map<string, (event: { session_id: string; payload: SubagentEventPayload }) => void>(),
  list: vi.fn(), nextSession: 0,
}));
vi.mock("./gatewayClient", () => ({
  GatewayClient: class {
    states = new Set<(state: string) => void>();
    onState(listener: (state: string) => void) { this.states.add(listener); return () => { this.states.delete(listener); }; }
    onRequest() { return () => {}; }
    on(name: string, listener: (event: { session_id: string; payload: SubagentEventPayload }) => void) {
      mock.events.set(name, listener); return () => { if (mock.events.get(name) === listener) mock.events.delete(name); };
    }
    async connect() { for (const listener of this.states) listener("open"); }
    close() { for (const listener of this.states) listener("closed"); }
    async request(method: string, params: Record<string, unknown>) {
      mock.requests.push({ method, params });
      if (method === "session.create" || method === "session.resume") return {
        session_id: "live-" + ++mock.nextSession, stored_session_id: method === "session.resume" ? params.session_id : "stored-" + mock.nextSession, info: {}, messages: [],
      };
      if (method === "session.list") return { sessions: [] };
      if (method === "subagent.list") return mock.list();
      if (method === "subagent.tail") return { subagent_id: params.subagent_id, available: true, text: "child log", truncated: false };
      throw new Error("Unexpected RPC " + method);
    }
  },
}));
const payload = (fields: Partial<SubagentEventPayload> = {}): SubagentEventPayload => ({ goal: "Work on backend", task_count: 1, task_index: 0, subagent_id: "child-a", ...fields });
beforeEach(() => { mock.requests.length = 0; mock.events.clear(); mock.nextSession = 0; mock.list.mockReset().mockResolvedValue({ subagents: [] }); });

describe("Web chat subagent monitoring", () => {
  it("merges live progress and snapshot hydration without reviving completed children or claiming missing ones finished", () => {
    let rows = applySubagentEvent([], "subagent.spawn_requested", payload(), 100);
    rows = applySubagentEvent(rows, "subagent.start", payload({ model: "child-model" }), 101);
    rows = applySubagentEvent(rows, "subagent.tool", payload({ tool_count: 4, tool_name: "terminal", tool_preview: "npm run build" }), 102);
    rows = applySubagentEvent(rows, "subagent.complete", payload({ status: "completed", summary: "Done", duration_seconds: 20 }), 120);
    rows = applySubagentEvent(rows, "subagent.progress", payload({ tool_count: 1 }), 121);
    expect(rows[0]).toMatchObject({ status: "completed", summary: "Done", tool_count: 4, model: "child-model", started_at: 100, durationSeconds: 20 });
    rows = reconcileSubagentSnapshot(rows, [{ subagent_id: "child-b", goal: "Frontend", status: "running", tool_count: 2 }]);
    expect(rows[0].summary).toBe("Done");
    expect(subagentFinished(rows[0])).toBe(true);
    const missing = reconcileSubagentSnapshot(rows, []);
    expect(missing[1]).toMatchObject({ status: "running", available: false });
    expect(subagentFinished(missing[1])).toBe(false);
    expect(applySubagentEvent(rows, "subagent.progress", payload({ subagent_id: null }))).toBe(rows);
  });

  it("scopes events/roster/logs to the active conversation and ignores stale snapshot or replacement-session responses", async () => {
    const controller = new WebChatController({ profile: "coding", restore: () => null, remember: () => {} });
    await controller.start();
    mock.events.get("subagent.start")?.({ session_id: "foreign", payload: payload() });
    expect(controller.getSnapshot().subagents).toEqual([]);
    let finish!: (value: SubagentListResult) => void;
    mock.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const reading = controller.refreshSubagents();
    mock.events.get("subagent.start")?.({ session_id: "live-1", payload: payload({ tool_count: 3 }) });
    finish({ subagents: [{ subagent_id: "child-a", status: "queued", tool_count: 0 }] });
    await reading;
    expect(controller.getSnapshot().subagents[0]).toMatchObject({ status: "running", tool_count: 3 });
    expect(await controller.getSubagentTail("child-a")).toMatchObject({ available: true, text: "child log" });
    expect(mock.requests.find((request) => request.method === "subagent.tail")?.params).toEqual({ session_id: "live-1", profile: "coding", subagent_id: "child-a" });
    mock.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const stale = controller.refreshSubagents();
    await controller.start(true);
    finish({ subagents: [{ subagent_id: "child-a", status: "running" }] });
    await stale;
    expect(controller.getSnapshot().subagents).toEqual([]);
    mock.events.get("subagent.complete")?.({ session_id: "live-2", payload: payload({ subagent_id: "child-b", status: "completed", summary: "Frontend done" }) });
    await controller.start(false, "stored-1");
    expect(controller.getSnapshot().subagents.map((row) => row.subagent_id)).toEqual(["child-a"]);
    mock.list.mockRejectedValueOnce(new JsonRpcGatewayError("method not found", { code: -32601 }));
    await controller.refreshSubagents();
    const calls = mock.requests.length;
    await controller.refreshSubagents();
    expect(mock.requests.length).toBe(calls);
    expect(controller.getSnapshot().subagentsUnsupported).toBe(true);
    expect(controller.getSnapshot().error).toBeNull();
    controller.stop();
  });
});
