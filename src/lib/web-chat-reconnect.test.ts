import { describe, expect, it } from "vitest";
import { shouldRetryWebChatClose, webChatReconnectDelayMs } from "./web-chat-reconnect";

describe("web-chat-reconnect policy", () => {
  it("computes bounded exponential backoff", () => {
    expect(webChatReconnectDelayMs(0)).toBe(1000);
    expect(webChatReconnectDelayMs(1)).toBe(2000);
    expect(webChatReconnectDelayMs(2)).toBe(4000);
    expect(webChatReconnectDelayMs(3)).toBe(8000);
    expect(webChatReconnectDelayMs(4)).toBe(16000);
    expect(webChatReconnectDelayMs(5)).toBe(30000);
    expect(webChatReconnectDelayMs(10)).toBe(30000);
  });

  it("decides retryability based on close code", () => {
    expect(shouldRetryWebChatClose(undefined)).toBe(true);
    expect(shouldRetryWebChatClose(1006)).toBe(true);
    expect(shouldRetryWebChatClose(1005)).toBe(true);
    expect(shouldRetryWebChatClose(1011)).toBe(true);
    expect(shouldRetryWebChatClose(1000)).toBe(false);
    expect(shouldRetryWebChatClose(4401)).toBe(false);
    expect(shouldRetryWebChatClose(4403)).toBe(false);
  });
});
