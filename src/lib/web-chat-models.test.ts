import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigSetResult } from "@hermes/shared";
import { WebChatController } from "./web-chat-controller";
import { sessionModelValue, webChatModelLabel, webChatModelProviders } from "./web-chat-models";

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  nextSession: 0,
  setModel: vi.fn(),
}));

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
beforeEach(() => { mock.requests.length = 0; mock.nextSession = 0; mock.setModel.mockReset(); });

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
