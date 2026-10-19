import type { SessionLiveInfo, SessionListRow, TranscriptMessage, TurnStatus, ServerRequest, ToolLabel } from "@hermes/shared";
import type { ConnectionState } from "./gatewayClient";
import { imageMessageContent, type ChatImage } from "./web-chat-images";
import type { WebChatSubagent } from "./web-chat-subagents";
import type { WebChatModelIdentity } from "./web-chat-models";
import { toolResultFailed } from "./web-chat-activity";

export interface ChatMessage {
  id: string;
  rowId?: number;
  toolCallId?: string;
  historyTurnId?: number;
  toolTurnStartedAt?: number;
  pendingSnapshot?: boolean;
  role: "user" | "assistant" | "commentary" | "tool" | "command";
  text: string;
  images?: ChatImage[];
  timestamp?: number;
  reasoning?: string;
  name?: string;
  toolArgs?: Record<string, unknown>;
  toolContext?: string;
  toolLabels?: ToolLabel[];
  durationSeconds?: number;
  resultSummary?: string;
  status?: TurnStatus | "working";
}
export interface WebChatUnsentTurn {
  text: string;
  files?: File[];
  error?: string;
  uncertain?: boolean;
}

export interface WebChatState {
  connection: ConnectionState;
  historyTruncated?: boolean;
  creationUncertain?: boolean;
  modelConfirmation?: { provider: string; model: string; message: string; sessionId: string } | null;
  view?: { details: Record<string, boolean>; subagent?: string | null };
  loading: boolean;
  busy: boolean;
  submitting: boolean;
  commandBusy: boolean;
  sendingImages: boolean;
  switchingModel: boolean;
  stopping: boolean;
  sessionId: string | null;
  storedSessionId: string | null;
  sessions: SessionListRow[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  info: SessionLiveInfo;
  sessionModel: WebChatModelIdentity | null;
  messages: ChatMessage[];
  requests: ServerRequest[];
  error: string | null;
  notice: string | null;
  subagents: WebChatSubagent[];
  subagentsError: string | null;
  subagentsUnsupported: boolean;
  reconnectAttempt: number;
  reconnectCountdown: number | null;
  unsentTurn: WebChatUnsentTurn | null;
}

export function initialWebChatState(): WebChatState {
  return {
    connection: "idle", loading: true, busy: false, submitting: false, commandBusy: false, sendingImages: false, switchingModel: false, stopping: false,
    sessionId: null, storedSessionId: null, sessions: [], sessionsLoading: false, sessionsError: null, info: {}, sessionModel: null, messages: [],
    requests: [], error: null, notice: null, subagents: [], subagentsError: null, subagentsUnsupported: false,
    reconnectAttempt: 0, reconnectCountdown: null, unsentTurn: null,
  };
}

export function transcriptMessages(rows: TranscriptMessage[]): ChatMessage[] {
  let historyTurnId: number | undefined;
  const occurrences = new Map<string, number>();
  return rows.flatMap((row, index): ChatMessage[] => {
    if (row.display_kind === "hidden") return [];
    if (!["user", "assistant", "tool"].includes(row.role)) return [];
    if (row.role === "user") historyTurnId = row.row_id ?? undefined;
    const toolCallId = row.role === "tool" ? row.tool_call_id || undefined : undefined;
    const callKey = historyTurnId + ":" + toolCallId;
    const occurrence = occurrences.get(callKey) ?? 0;
    if (toolCallId) occurrences.set(callKey, occurrence + 1);
    const toolId = toolCallId ? "tool:" + (historyTurnId == null ? "" : "user-" + historyTurnId + ":") + toolCallId + (occurrence ? ":occ-" + occurrence : "") : null;
    const text = row.role === "tool" ? row.text || (row.content != null ? toolResultText(row.content) : "") : row.text ?? "";
    const content = row.role === "user" ? imageMessageContent(text) : { text, images: [] };
    return [{
      id: row.row_id != null ? "history:" + row.row_id : toolId ?? "history:" + index,
      rowId: row.row_id ?? undefined, toolCallId, historyTurnId,
      role: row.role as ChatMessage["role"],
      text: content.text,
      images: content.images.length ? content.images : undefined,
      timestamp: row.timestamp ?? undefined,
      name: row.name ?? undefined,
      reasoning: row.reasoning ?? undefined,
      toolArgs: row.args ?? undefined,
      toolContext: row.context ?? undefined,
      toolLabels: row.labels ?? undefined,
      ...(row.role === "tool" ? { status: toolResultFailed(row.content) ? "error" : "complete" } : {}),
    }];
  });
}

export function toolResultText(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "";
  return text.length > 12_000 ? text.slice(0, 12_000) + "\n…" : text;
}
