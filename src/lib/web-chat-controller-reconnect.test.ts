import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebChatController } from "./web-chat-controller";
import { WEB_CHAT_MAX_RECONNECT_ATTEMPTS } from "./web-chat-reconnect";

let latestClient: MockClient | null = null;
let allConnectsFail = false;

class MockClient {
  states = new Set<(state: string) => void>();
  connected = false;
  connectFails = false;
  constructor() {
    latestClient = this;
  }

  onState(listener: (state: string) => void) {
    this.states.add(listener);
    return () => { this.states.delete(listener); };
  }
  onRequest() { return () => {}; }
  on() { return () => {}; }

  async connect() {
    if (allConnectsFail) {
      for (const listener of this.states) listener("closed");
      throw new Error("Connection failed");
    }
    this.connected = true;
    for (const listener of this.states) listener("open");
  }

  close() {
    this.connected = false;
    for (const listener of this.states) listener("closed");
  }

  triggerState(state: string) {
    for (const listener of this.states) listener(state);
  }

  async request(method: string) {
    if (method === "session.create" || method === "session.resume") {
      return { session_id: "live-s", stored_session_id: "stored-s", info: {}, messages: [] };
    }
    if (method === "session.list") return { sessions: [] };
    if (method === "prompt.submit") return { status: "streaming" };
    throw new Error("Unexpected RPC " + method);
  }
}
vi.mock("./gatewayClient", () => ({
  GatewayClient: class {
    constructor() {
      return new MockClient();
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  latestClient = null;
  allConnectsFail = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WebChatController auto-reconnect and unsent-turn recovery", () => {
  it("schedules auto-reconnect with countdown on unexpected socket close", async () => {
    const controller = new WebChatController({ profile: "test", restore: () => null, remember: () => {} });
    await controller.start();
    expect(controller.getSnapshot().connection).toBe("open");
    expect(controller.getSnapshot().reconnectAttempt).toBe(0);

    // Simulate unexpected disconnect
    latestClient?.triggerState("closed");
    expect(controller.getSnapshot().connection).toBe("closed");
    expect(controller.getSnapshot().reconnectAttempt).toBe(1);
    expect(controller.getSnapshot().reconnectCountdown).toBe(1); // 1s base delay

    // Advance 1s: timer fires and starts reconnecting
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot().connection).toBe("open");
    expect(controller.getSnapshot().reconnectAttempt).toBe(0);
    expect(controller.getSnapshot().reconnectCountdown).toBeNull();
  });

  it("reconnectNow immediately reconnects and clears countdown", async () => {
    const controller = new WebChatController({ profile: "test", restore: () => null, remember: () => {} });
    await controller.start();

    latestClient?.triggerState("closed");
    expect(controller.getSnapshot().reconnectCountdown).toBe(1);

    await controller.reconnectNow();
    expect(controller.getSnapshot().connection).toBe("open");
    expect(controller.getSnapshot().reconnectCountdown).toBeNull();
  });

  it("stops retrying after reaching maximum reconnect attempts", async () => {
    const controller = new WebChatController({ profile: "test", restore: () => null, remember: () => {} });
    await controller.start();
    allConnectsFail = true;
    latestClient?.triggerState("closed");

    // Advance enough time for all retries to exhaust
    await vi.advanceTimersByTimeAsync(300_000);

    expect(controller.getSnapshot().reconnectAttempt).toBe(WEB_CHAT_MAX_RECONNECT_ATTEMPTS);
    expect(controller.getSnapshot().reconnectCountdown).toBeNull();
    // Subsequent close events do not restart retries
    latestClient?.triggerState("closed");
    expect(controller.getSnapshot().reconnectCountdown).toBeNull();
  });

  it("captures unsent turns when disconnected and allows retry or dismissal", async () => {
    const controller = new WebChatController({ profile: "test", restore: () => null, remember: () => {} });
    // Not yet connected
    expect(await controller.submit("Offline message")).toBe(false);
    expect(controller.getSnapshot().unsentTurn).toMatchObject({ text: "Offline message" });

    // Now connect
    await controller.start();
    expect(controller.getSnapshot().connection).toBe("open");

    // Retry unsent turn
    const ok = await controller.retryUnsent();
    expect(ok).toBe(true);
    expect(controller.getSnapshot().unsentTurn).toBeNull();
  });

  it("dismissUnsent returns the turn text and clears the notice", async () => {
    const controller = new WebChatController({ profile: "test", restore: () => null, remember: () => {} });
    await controller.submit("Another offline message");
    expect(controller.getSnapshot().unsentTurn?.text).toBe("Another offline message");

    const dismissed = controller.dismissUnsent();
    expect(dismissed?.text).toBe("Another offline message");
    expect(controller.getSnapshot().unsentTurn).toBeNull();
  });
});
