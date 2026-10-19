import type { GatewayEvent, ServerRequest } from "@hermes/shared";
import type { ChatMessage, WebChatState } from "./web-chat-state";

export const CHAT_LIMITS = { bindings: 16, histories: 8, historyBytes: 64 * 1024 ** 2,
  rows: 400, sessionBytes: 8 * 1024 ** 2, previewBytes: 256 * 1024,
  bufferBytes: 8 * 1024 ** 2, requests: 128, requestBytes: 2 * 1024 ** 2,
  drafts: 4 * 1024 ** 2, images: 100 * 1024 ** 2, closedDrafts: 8,
  mediaBytes: 32 * 1024 ** 2, mediaEntries: 64 } as const;

// Protocol payloads and projected rows are immutable. Cache estimates by identity;
// generating JSON just to measure it would copy every growing body on each token.
const sizes = new WeakMap<object, number>();
const requestSizes = new WeakMap<readonly ServerRequest[], number>();
export function retainedBytes(value: unknown): number {
  if (typeof value === "string") return value.length * 2;
  if (typeof value === "number") return 8;
  if (typeof value === "boolean") return 4;
  if (value === null) return 4;
  if (typeof value !== "object") return 0;
  const known = sizes.get(value); if (known !== undefined) return known;
  const bytes = Array.isArray(value)
    ? 16 + value.reduce((sum, item) => sum + 8 + retainedBytes(item), 0)
    : 32 + Object.entries(value).reduce((sum, [key, item]) => sum + key.length * 2 + 8 + retainedBytes(item), 0);
  sizes.set(value, bytes); return bytes;
}
export function historyBytes(rows: ChatMessage[]): number { return retainedBytes(rows); }
export function cacheHistoryReplacement(next: ChatMessage[], previous: ChatMessage[], before: ChatMessage, after: ChatMessage) {
  sizes.set(next, historyBytes(previous) - retainedBytes(before) + retainedBytes(after));
}
export function cacheHistoryAppend(next: ChatMessage[], previous: ChatMessage[], row: ChatMessage) {
  sizes.set(next, historyBytes(previous) + 8 + retainedBytes(row));
}
export function requestBytes(request: ServerRequest): number {
  return 32 + retainedBytes(request.id) + retainedBytes(request.method) + retainedBytes(request.params);
}
export function requestsBytes(requests: readonly ServerRequest[]): number {
  const known = requestSizes.get(requests); if (known !== undefined) return known;
  const bytes = requests.reduce((sum, request) => sum + requestBytes(request), 0);
  requestSizes.set(requests, bytes); return bytes;
}

export class ChatEventBuffer {
  private entries: GatewayEvent[] = [];
  private size = 0;
  get items(): readonly GatewayEvent[] { return this.entries; }
  get bytes() { return this.size; }
  push(event: GatewayEvent, availableBytes: number): boolean {
    const bytes = retainedBytes(event) + 8;
    if (this.size + bytes > availableBytes) return false;
    this.entries.push(event); this.size += bytes; return true;
  }
  drain() { const items = this.entries; this.clear(); return items; }
  clear() { this.entries = []; this.size = 0; }
}

export function trimHistory(rows: ChatMessage[]): { messages: ChatMessage[]; truncated: boolean } {
  if (rows.length <= CHAT_LIMITS.rows && historyBytes(rows) <= CHAT_LIMITS.sessionBytes)
    return { messages: rows, truncated: false };
  let messages = rows.length > CHAT_LIMITS.rows ? rows.slice(-CHAT_LIMITS.rows) : rows;
  if (historyBytes(messages) > CHAT_LIMITS.sessionBytes) {
    const tail: ChatMessage[] = []; let bytes = 16;
    for (let i = messages.length - 1; i >= 0; i--) {
      let row = messages[i];
      if (retainedBytes(row) > CHAT_LIMITS.sessionBytes / 2) {
        const chars = CHAT_LIMITS.sessionBytes / 8;
        row = { ...row, text: row.text.slice(-chars), reasoning: row.reasoning?.slice(-chars), toolArgs: undefined };
      }
      const size = retainedBytes(row) + 8; if (bytes + size > CHAT_LIMITS.sessionBytes) break;
      tail.unshift(row); bytes += size;
    }
    messages = tail; sizes.set(messages, bytes);
  }
  return { messages, truncated: true };
}
export function clientBusy(state: WebChatState): boolean {
  return state.submitting || state.commandBusy || state.sendingImages || state.switchingModel || !!state.modelConfirmation;
}
export function sessionTitle(state: WebChatState): string | null {
  const row = state.sessions.find(row => row.id === state.storedSessionId);
  return (state.info.title || (row?.message_count ? row.title || row.preview : "") ||
    state.messages.find(row => row.role === "user")?.text || "").replace(/\s+/g, " ").trim().slice(0, 240) || null;
}
