import type { SubagentEventPayload, SubagentSnapshot, SubagentStatus } from "@hermes/shared";

export const SUBAGENT_EVENTS = ["subagent.spawn_requested", "subagent.start", "subagent.progress", "subagent.thinking", "subagent.tool", "subagent.complete"] as const;
export type SubagentEventName = typeof SUBAGENT_EVENTS[number];

export interface WebChatSubagent extends SubagentSnapshot {
  available: boolean;
  summary?: string;
  activity?: string;
  durationSeconds?: number;
}

const TERMINAL = new Set<SubagentStatus>(["completed", "failed", "error", "timeout", "interrupted"]);
export function subagentFinished(row: Pick<SubagentSnapshot, "status">): boolean {
  return !!row.status && TERMINAL.has(row.status);
}

function mergeSubagent(previous: WebChatSubagent | undefined, patch: WebChatSubagent): WebChatSubagent {
  return {
    ...previous, ...patch,
    status: previous && subagentFinished(previous) ? previous.status : patch.status || previous?.status,
    tool_count: Math.max(previous?.tool_count || 0, patch.tool_count || 0),
  };
}

export function applySubagentEvent(rows: WebChatSubagent[], event: SubagentEventName, payload: SubagentEventPayload, now = Date.now() / 1000): WebChatSubagent[] {
  const id = payload.subagent_id;
  if (!id) return rows; // Legacy identity-free events need the roster RPC; never fabricate an actionable ID.
  const previous = rows.find((row) => row.subagent_id === id);
  const status = payload.status || (event === "subagent.spawn_requested" ? "queued" : event === "subagent.complete" ? undefined : "running");
  const row = mergeSubagent(previous, {
    subagent_id: id, available: true, status,
    goal: payload.goal || previous?.goal,
    parent_id: payload.parent_id ?? previous?.parent_id,
    depth: payload.depth ?? previous?.depth,
    model: payload.model || previous?.model,
    started_at: previous?.started_at ?? now,
    delegation_id: payload.delegation_id ?? previous?.delegation_id,
    tool_count: payload.tool_count ?? previous?.tool_count,
    last_tool: payload.tool_name || previous?.last_tool,
    summary: payload.summary?.slice(-8_192) || previous?.summary,
    activity: (payload.tool_preview || payload.text)?.slice(-2_000) || previous?.activity,
    durationSeconds: payload.duration_seconds ?? previous?.durationSeconds,
  });
  return previous ? rows.map((item) => item.subagent_id === id ? row : item) : [...rows, row];
}

/** Missing children are unavailable, never assumed complete; keep known completion summaries. */
export function reconcileSubagentSnapshot(rows: WebChatSubagent[], snapshot: SubagentSnapshot[]): WebChatSubagent[] {
  const incoming = new Map(snapshot.map((row) => [row.subagent_id, row]));
  const result = rows.map((row) => {
    const fresh = incoming.get(row.subagent_id);
    incoming.delete(row.subagent_id);
    return fresh ? mergeSubagent(row, { ...fresh, available: true }) : { ...row, available: false };
  });
  for (const row of incoming.values()) result.push({ ...row, available: true });
  return result;
}
