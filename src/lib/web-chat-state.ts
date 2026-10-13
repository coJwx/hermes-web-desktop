import type { SessionLiveInfo, SessionListRow, TranscriptMessage, TurnStatus, ServerRequest, ToolLabel } from "@hermes/shared";
import type { ConnectionState } from "./gatewayClient";
import { imageMessageContent, type ChatImage } from "./web-chat-images";
import type { WebChatSubagent } from "./web-chat-subagents";

export interface ChatMessage {
  id: string;
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
}

export interface WebChatState {
  connection: ConnectionState;
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
    sessionId: null, storedSessionId: null, sessions: [], sessionsLoading: false, sessionsError: null, info: {}, messages: [],
    requests: [], error: null, notice: null, subagents: [], subagentsError: null, subagentsUnsupported: false,
    reconnectAttempt: 0, reconnectCountdown: null, unsentTurn: null,
  };
}

export function transcriptMessages(rows: TranscriptMessage[]): ChatMessage[] {
  return rows.flatMap((row, index): ChatMessage[] => {
    if (row.display_kind === "hidden") return [];
    if (!["user", "assistant", "tool"].includes(row.role)) return [];
    const content = row.role === "user" ? imageMessageContent(row.text ?? "") : { text: row.text ?? "", images: [] };
    return [{
      id: "history:" + (row.row_id ?? index),
      role: row.role as ChatMessage["role"],
      text: content.text,
      images: content.images.length ? content.images : undefined,
      timestamp: row.timestamp ?? undefined,
      name: row.name ?? undefined,
      reasoning: row.reasoning ?? undefined,
      toolArgs: row.args ?? undefined,
      toolContext: row.context ?? undefined,
      toolLabels: row.labels ?? undefined,
    }];
  });
}

export function toolResultText(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "";
  return text.length > 12_000 ? text.slice(0, 12_000) + "\n…" : text;
}
