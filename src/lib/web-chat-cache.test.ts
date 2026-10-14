import { expect, it } from "vitest";
import { CHAT_LIMITS, cacheHistoryAppend, cacheHistoryReplacement, historyBytes, retainedBytes, trimHistory, requestsBytes } from "./web-chat-cache";
import type { ChatMessage } from "./web-chat-state";
import type { ServerRequest } from "@hermes/shared";

it("keeps incremental history estimates consistent after append, replacement and trimming without re-reading unchanged rows", () => {
  let reads = 0;
  const stable: ChatMessage = { id: "stable", role: "user", get text() { reads++; return "Old history"; } };
  const before: ChatMessage = { id: "reply", role: "assistant", text: "a" };
  const original = [stable, before]; const initial = historyBytes(original); reads = 0;
  const after = { ...before, text: "a".repeat(1024), reasoning: "Thought" };
  const next = [stable, after]; cacheHistoryReplacement(next, original, before, after);
  expect(historyBytes(next) - initial).toBe(retainedBytes(after) - retainedBytes(before));
  expect(historyBytes(next)).toBe(historyBytes([...next]));
  const command: ChatMessage = { id: "command", role: "command", text: "Done" };
  const appended = [...next, command]; cacheHistoryAppend(appended, next, command);
  expect(historyBytes(appended)).toBe(historyBytes([...appended])); expect(reads).toBe(0);
  expect(trimHistory(appended).messages).toBe(appended);
  const oversized = [...appended, { ...after, text: "x".repeat(CHAT_LIMITS.sessionBytes) }];
  const trimmed = trimHistory(oversized);
  expect(trimmed.truncated).toBe(true); expect(historyBytes(trimmed.messages)).toBeLessThanOrEqual(CHAT_LIMITS.sessionBytes);
  expect(historyBytes(trimmed.messages)).toBe(historyBytes([...trimmed.messages]));
});

it("accounts for replayed, answered and cancelled request metadata by immutable identity", () => {
  let reads = 0;
  const first: ServerRequest = { id: "r1", method: "approval", params: { get command() { reads++; return "review"; } }, respond: () => {}, fail: () => {} };
  const requests = [first]; const bytes = requestsBytes(requests); reads = 0;
  expect(requestsBytes(requests)).toBe(bytes); expect(requestsBytes([...requests])).toBe(bytes); expect(reads).toBe(0);
  const replayed = { ...first, params: { command: "a".repeat(1024) } };
  expect(requestsBytes([replayed])).toBeGreaterThan(bytes);
  expect(requestsBytes([])).toBe(0);
  expect(requestsBytes([first, replayed])).toBe(requestsBytes([first]) + requestsBytes([replayed]));
});
