import type { GatewayEvent } from "@hermes/shared";
import { toolResultText, type ChatMessage } from "./web-chat-state";
import { toolResultFailed } from "./web-chat-activity";
import { cacheHistoryAppend, cacheHistoryReplacement } from "./web-chat-cache";

export type WebChatToolEvent = GatewayEvent<"tool.start"> | GatewayEvent<"tool.complete">;

export function projectToolEvent(messages: ChatMessage[], event: WebChatToolEvent, nextId: () => number, turnStartedAt?: number | null, beforeId?: string | null): ChatMessage[] {
  if (!event.payload) return messages;
  const callId = event.payload.tool_id;
  const lastUser = messages.findLastIndex(row => row.role === "user");
  let index = messages.findLastIndex((row, i) => i > lastUser && row.role === "tool" && row.toolCallId === callId &&
    (turnStartedAt == null || row.toolTurnStartedAt == null || row.toolTurnStartedAt === turnStartedAt));
  const candidate = messages[index];
  // A full snapshot may already contain a call whose lifecycle frames were held
  // during recovery. Do not restart or duplicate that completed history row.
  if (event.type === "tool.start" && candidate && !candidate.pendingSnapshot && candidate.toolTurnStartedAt == null) return messages;
  if (event.type === "tool.start" && candidate?.status !== "working") index = -1;
  if (event.type === "tool.complete" && messages.filter((row, i) => i > lastUser && row.toolCallId === callId).length > 1 && !candidate?.pendingSnapshot) index = -1;
  const old = messages[index];
  const id = old?.id ?? "tool-live:" + event.session_id + ":" + nextId();
  let row: ChatMessage;
  if (event.type === "tool.start") {
    const p = event.payload!;
    row = { ...old, id, role: "tool", name: p.name, text: old?.text ?? "", status: "working",
      toolArgs: p.args ?? old?.toolArgs, toolContext: p.context ?? p.preview ?? old?.toolContext,
      toolLabels: p.labels ?? old?.toolLabels };
  } else {
    const p = event.payload!;
    row = { ...old, id, role: "tool", name: p.name,
      text: p.result_text ?? (p.result === undefined ? old?.text || p.summary || "" : toolResultText(p.result)),
      status: toolResultFailed(p.result) || (p.result === undefined && old?.status === "error") ? "error" : "complete", resultSummary: p.summary ?? old?.resultSummary,
      durationSeconds: p.duration_s ?? old?.durationSeconds, toolArgs: p.args ?? old?.toolArgs,
      toolLabels: p.labels ?? old?.toolLabels };
  }
  row.toolCallId = callId; row.toolTurnStartedAt = turnStartedAt ?? old?.toolTurnStartedAt;
  row.pendingSnapshot = old ? old.pendingSnapshot ?? false : true;
  const next = messages.slice();
  if (old) { next[index] = row; cacheHistoryReplacement(next, messages, old, row); }
  else {
    const before = beforeId ? next.findIndex(item => item.id === beforeId) : -1;
    next.splice(before >= 0 ? before : next.length, 0, row); cacheHistoryAppend(next, messages, row);
  }
  return next;
}
