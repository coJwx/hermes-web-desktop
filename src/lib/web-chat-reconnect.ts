import { reconnectBackoffDelayMs } from "@hermes/shared";

export const WEB_CHAT_RECONNECT_BASE_MS = 1_000;
export const WEB_CHAT_RECONNECT_MAX_MS = 30_000;
export const WEB_CHAT_MAX_RECONNECT_ATTEMPTS = 10;

const WS_CLOSE_NORMAL = 1000;
const WS_CLOSE_AUTH_CODES = new Set([4401, 4403]);

/**
 * Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s cap.
 */
export function webChatReconnectDelayMs(attempt: number): number {
  return reconnectBackoffDelayMs(attempt, {
    baseDelayMs: WEB_CHAT_RECONNECT_BASE_MS,
    capMs: WEB_CHAT_RECONNECT_MAX_MS,
    jitter: false,
  });
}

/**
 * Normal 1000 close or authentication rejection (4401/4403) are not retried.
 * Other closures (network drop, 1006, server restart) are retried.
 */
export function shouldRetryWebChatClose(code?: number): boolean {
  if (code === undefined) return true;
  return code !== WS_CLOSE_NORMAL && !WS_CLOSE_AUTH_CODES.has(code);
}
