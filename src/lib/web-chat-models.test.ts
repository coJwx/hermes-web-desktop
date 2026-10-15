import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigSetResult } from "@hermes/shared";
import { WebChatController } from "./web-chat-controller";
import { sessionModelValue, storedSessionModel, webChatModelLabel, webChatModelProviders } from "./web-chat-models";

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  nextSession: 0,
  setModel: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("./api", () => ({ api: { getSessionDetail: mock.detail } }));

vi.mock("./gatewayClient", () => ({
  GatewayClient: class {
    states = new Set<(state: string) => void>();
    onState(listener: (state: string) => void) { this.states.add(listener); return () => { this.states.delete(listener); }; }
    onRequest() { return () => {}; }
    on() { return () => {}; }
    async connect() { for (const listener of this.states) listener("open"); }
    close() { for (const listener of this.states) listener("closed"); }
    async request(method: string, params: Record<string, unknown>) {
      mock.requests.push({ method, params });
      if (method === "session.create") return {
        session_id: "live-" + ++mock.nextSession, stored_session_id: "stored-" + mock.nextSession,
        info: { provider: "custom:original", model: "original-model" }, messages: [],
      };
      if (method === "session.list") return { sessions: [] };
      if (method === "model.options") return { providers: [{ slug: "custom:gemini", name: "Gemini", models: ["gemini-3.8-flash-medium"] }], model: "original-model", provider: "custom:original" };
      if (method === "config.set") return mock.setModel(params);
      throw new Error("Unexpected RPC " + method);
    }
  },
}));

const createController = () => new WebChatController({ profile: "coding", restore: () => null, remember: () => {} });
beforeEach(() => { mock.requests.length = 0; mock.nextSession = 0; mock.setModel.mockReset(); mock.detail.mockReset().mockResolvedValue({}); });

describe("Stored conversation model identity", () => {
  it("decodes string/object routes and rejects missing or malformed metadata without guessing a provider", () => {
    const identity = { provider: "custom:yyapi-responses", model: "gpt-6.1-sol" };
    expect(storedSessionModel(JSON.stringify({ ...identity, api_mode: "codex_responses", base_url: "https://example.test/v1" }))).toEqual(identity);
    expect(storedSessionModel(identity)).toEqual(identity);
    expect(storedSessionModel({ provider: identity.provider }, identity.model)).toEqual(identity);
    expect(storedSessionModel({ provider: "custom:old", model: identity.model, gateway_runtime: { provider: identity.provider } })).toEqual(identity);
    for (const config of [undefined, null, "", "{bad", "null", "[]", [], 1, {}, { provider: " " }, { provider: 42 }, { provider: identity.provider, model: 42 }]) {
      expect(storedSessionModel(config)).toBeNull();
    }
  });

  it("discards delayed session metadata after a model switch or conversation replacement", async () => {
    const pending: Array<(detail: unknown) => void> = [];
    mock.detail.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const controller = createController();
    await controller.start();
    expect(mock.detail).toHaveBeenCalledWith("stored-1", "coding", expect.any(AbortSignal));
    mock.setModel.mockResolvedValue({ key: "model", value: "chosen", scope: "session" });
    await controller.switchModel("custom:selected", "chosen");
    pending[0]({ id: "stored-1", model_config: { provider: "custom:old", model: "old" } });
    await Promise.resolve();
    expect(controller.getSnapshot().sessionModel).toEqual({ provider: "custom:selected", model: "chosen" });

    const oldRead = controller.refreshSessionModel(true);
    await controller.start(true);
    pending[2]({ id: "stored-2", model_config: { provider: "custom:new", model: "new" } });
    await Promise.resolve();
    pending[1]({ id: "stored-1", model_config: { provider: "custom:old", model: "old" } });
    await oldRead;
    expect(controller.getSnapshot().sessionModel).toEqual({ provider: "custom:new", model: "new" });
    const reads = mock.detail.mock.calls.length;
    await controller.refreshSessionModel();
    expect(mock.detail).toHaveBeenCalledTimes(reads);
    controller.stop();
  });

  it("keeps WS metadata usable when REST fails or model_config is malformed", async () => {
    const controller = createController();
    mock.detail.mockRejectedValueOnce(new Error("Session detail unavailable"));
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ sessionModel: null, error: null, loading: false,
      info: { provider: "custom:original", model: "original-model" } });
    mock.detail.mockResolvedValueOnce({ id: "stored-1", model_config: "{bad" });
    await controller.refreshSessionModel(true);
    expect(controller.getSnapshot()).toMatchObject({ sessionModel: null, error: null,
      info: { provider: "custom:original", model: "original-model" } });
    controller.stop();
  });
});

describe("Current-conversation model selection", () => {
  it("loads profile-scoped options, switches only the live session, and blocks overlapping sends/switches", async () => {
    const controller = createController();
    const other = createController();
    await controller.start();
    await other.start();
    const options = await controller.getModelOptions();
    expect(mock.requests.find((request) => request.method === "model.options")?.params).toEqual({
      session_id: "live-1", profile: "coding", refresh: false, include_unconfigured: false,
    });
    const rows = webChatModelProviders(options.providers, "custom:gemini", "gemini-3.8-flash-medium");
    expect(rows[0].models).toContain("gemini-3.8-flash-medium");
    expect(webChatModelLabel("custom:gemini", "gemini-3.8-flash-medium")).toBe("custom:gemini/gemini-3.8-flash-medium");
    expect(sessionModelValue("openrouter", "google/gemini-3.8-flash")).toBe("google/gemini-3.8-flash --provider openrouter --session");
    expect(() => sessionModelValue("custom:gemini --global", "model")).toThrow();
    let finish!: (value: ConfigSetResult) => void;
    mock.setModel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const switching = controller.switchModel("custom:gemini", "gemini-3.8-flash-medium");
    expect(controller.getSnapshot().switchingModel).toBe(true);
    expect(await controller.submit("wait")).toBe(false);
    expect(await controller.switchSession("other")).toBe(false);
    expect(await controller.switchModel("custom:other", "other-model")).toBeNull();
    finish({ key: "model", value: "gemini-3.8-flash-medium", scope: "session" });
    expect((await switching)?.scope).toBe("session");
    expect(mock.requests.filter((request) => request.method === "config.set")).toEqual([{
      method: "config.set", params: { session_id: "live-1", profile: "coding", key: "model",
        value: "gemini-3.8-flash-medium --provider custom:gemini --session", confirm_expensive_model: false },
    }]);
    expect(controller.getSnapshot().info).toMatchObject({ provider: "custom:gemini", model: "gemini-3.8-flash-medium" });
    expect(other.getSnapshot().info).toMatchObject({ provider: "custom:original", model: "original-model" });
    expect(controller.getSnapshot().messages).toEqual([]);
    expect(controller.getSnapshot().switchingModel).toBe(false);
    controller.stop(); other.stop();
  });

  it("keeps the active model on confirmation/refusal and discards stale replies after replacing the conversation", async () => {
    const controller = createController();
    await controller.start();
    mock.setModel.mockResolvedValueOnce({ key: "model", value: "costly", confirm_required: true, confirm_message: "Confirm price" });
    expect((await controller.switchModel("custom:gemini", "costly"))?.confirm_required).toBe(true);
    expect(controller.getSnapshot().info.model).toBe("original-model");
    mock.setModel.mockRejectedValueOnce(new Error("switch refused"));
    await expect(controller.switchModel("custom:gemini", "costly", true)).rejects.toThrow("switch refused");
    expect(controller.getSnapshot().info.model).toBe("original-model");
    expect(mock.requests.filter((request) => request.method === "config.set").at(-1)?.params.confirm_expensive_model).toBe(true);
    let finish!: (value: ConfigSetResult) => void;
    mock.setModel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const switching = controller.switchModel("custom:gemini", "old-choice");
    const staleResult = expect(switching).rejects.toThrow("conversation changed");
    await controller.start(true);
    finish({ key: "model", value: "old-choice", scope: "session" });
    await staleResult;
    expect(controller.getSnapshot().sessionId).toBe("live-2");
    expect(controller.getSnapshot().info.model).toBe("original-model");
    expect(controller.getSnapshot().switchingModel).toBe(false);
    controller.stop();
  });
});
