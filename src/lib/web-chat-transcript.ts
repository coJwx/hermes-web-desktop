import type { ChatMessage } from "./web-chat-state";

interface SnapshotDisplayOptions { sameRuntime: boolean; running: boolean; turnStartedAt?: number | null }

function uniqueTools(rows: ChatMessage[]) {
  const calls = new Map<string, ChatMessage | null>();
  for (const row of rows) if (row.role === "tool" && row.toolCallId) {
    calls.set(row.toolCallId, calls.has(row.toolCallId) ? null : row);
  }
  return calls;
}

/** Reconcile display metadata by identity; snapshot text is always replaced, never appended. */
export function reconcileSnapshotMessages(next: ChatMessage[], previous: ChatMessage[], options: SnapshotDisplayOptions): ChatMessage[] {
  const oldRows = new Map(previous.flatMap(row => row.rowId == null ? [] : [[row.rowId, row] as const]));
  const oldTools = uniqueTools(previous);
  const newTools = uniqueTools(next);
  const messages = next.map(row => {
    let old = row.rowId == null ? undefined : oldRows.get(row.rowId);
    if (old && old.role !== row.role) old = undefined;
    // Reused call IDs are not proof of an invocation's identity, even if a late
    // event updated one of their compact history rows before both were visible.
    if (row.role === "tool" && row.toolCallId && newTools.get(row.toolCallId) === null) return { ...row, id: old?.id ?? row.id };
    if (!old && options.sameRuntime && row.toolCallId && newTools.get(row.toolCallId) === row) {
      const candidate = oldTools.get(row.toolCallId);
      const sameHistoryTurn = candidate?.historyTurnId != null && candidate.historyTurnId === row.historyTurnId;
      const differentHistoryTurn = candidate?.historyTurnId != null && row.historyTurnId != null && candidate.historyTurnId !== row.historyTurnId;
      const differentLiveTurn = candidate?.toolTurnStartedAt != null && options.turnStartedAt != null && candidate.toolTurnStartedAt !== options.turnStartedAt;
      if (candidate && !differentHistoryTurn && (sameHistoryTurn || !differentLiveTurn)) old = candidate;
    }
    if (!old) return row;
    if (row.role !== "tool") return { ...row, id: old.id, reasoning: row.reasoning ?? old.reasoning };
    return { ...row, id: old.id, text: row.text || old.text,
      toolArgs: row.toolArgs ?? old.toolArgs, toolContext: row.toolContext ?? old.toolContext,
      toolLabels: row.toolLabels ?? old.toolLabels, durationSeconds: old.durationSeconds,
      resultSummary: old.resultSummary, toolTurnStartedAt: old.toolTurnStartedAt,
      status: !row.text && old.status === "error" ? "error" as const : row.status };
  });
  // Pending calls may not have reached history yet. Retain only tools proven to
  // belong to the same running server turn; no text/name-based or cross-runtime joins.
  if (options.sameRuntime && options.running && options.turnStartedAt != null) {
    for (const row of previous) if (row.role === "tool" && row.pendingSnapshot && row.toolCallId &&
      row.toolTurnStartedAt === options.turnStartedAt && !newTools.has(row.toolCallId)) messages.push(row);
  }
  return messages;
}

/** Older peers without a turn timestamp use a rendering slot, not an inferred turn identity. */
export function inflightMessageId(runtimeId: string, turnStartedAt: number | null | undefined, role: "user" | "assistant") {
  return "inflight:" + runtimeId + ":" + (turnStartedAt ?? "current") + ":" + role;
}
