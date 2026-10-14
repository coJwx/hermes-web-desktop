import type { WebChatTransport } from "./web-chat-controller";
import type { ChatMessage, WebChatState } from "./web-chat-state";
import { toolResultText } from "./web-chat-state";
import { toolResultFailed } from "./web-chat-activity";
import { applySubagentEvent, SUBAGENT_EVENTS } from "./web-chat-subagents";

interface SessionEventContext {
  state: () => WebChatState;
  update: (patch: Partial<WebChatState>) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  assistant: () => ChatMessage;
  assistantId: () => string | null;
  clearAssistant: () => void;
  nextId: () => number;
  refreshSessions: () => Promise<void>;
  refreshSubagents: () => Promise<boolean>;
}

export function attachSessionEvents(client: WebChatTransport, context: SessionEventContext, current: () => boolean) {
  const own = (sid?: string) => current() && !!sid && sid === context.state().sessionId;
  return [
      client.on("request.cancel", (event) => {
        if (!current()) return;
        context.update({ requests: context.state().requests.filter((item) => item.id !== event.payload?.id) });
      }),
      client.on("session.info", (event) => {
        if (own(event.session_id)) context.update({ info: { ...context.state().info, ...event.payload },
          storedSessionId: event.payload?.stored_session_id ?? context.state().storedSessionId });
      }),
      client.on("sessions.changed", () => {
        if (current() && !context.state().loading) void context.refreshSessions();
      }),
      client.on("message.start", (event) => {
        if (own(event.session_id)) context.update({ busy: true, error: null });
      }),
      client.on("message.delta", (event) => {
        if (!own(event.session_id)) return;
        const row = context.assistant();
        context.patchMessage(row.id, { text: row.text + (event.payload?.text ?? "") });
      }),
      client.on("reasoning.delta", (event) => {
        if (!own(event.session_id)) return;
        const row = context.assistant();
        context.patchMessage(row.id, { reasoning: (row.reasoning ?? "") + (event.payload?.text ?? "") });
      }),
      client.on("reasoning.available", (event) => {
        if (own(event.session_id)) context.patchMessage(context.assistant().id, { reasoning: event.payload?.text ?? "" });
      }),
      client.on("message.interim", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const row = event.payload.already_streamed ? context.assistant() : null;
        if (row) context.patchMessage(row.id, { role: "commentary", text: event.payload.text, status: "complete" });
        else context.update({ messages: [...context.state().messages, { id: "interim:" + context.nextId(), role: "commentary", text: event.payload.text }] });
        context.clearAssistant();
      }),
      client.on("message.complete", (event) => {
        if (!own(event.session_id)) return;
        const row = context.assistant();
        const payload = event.payload;
        context.patchMessage(row.id, {
          text: typeof payload?.text === "string" ? payload.text : row.text,
          reasoning: payload?.reasoning ?? row.reasoning,
          status: payload?.status ?? "complete",
        });
        context.clearAssistant();
        context.update({ busy: false, stopping: false, error: payload?.error ?? (payload?.status === "error" ? payload.failure_reason ?? "Hermes could not complete this turn." : null), notice: payload?.warning ?? null });
        void context.refreshSessions();
      }),
      client.on("tool.start", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const p = event.payload;
        // A tool boundary seals the current reasoning/preamble, so final text appears AFTER tools.
        const preceding = context.state().messages.find((message) => message.id === context.assistantId());
        if (preceding) context.patchMessage(preceding.id, { role: preceding.text.trim() ? "commentary" : "assistant", status: "complete" });
        context.clearAssistant();
        const row: ChatMessage = {
          id: "tool:" + p.tool_id, role: "tool", name: p.name, text: "", status: "working",
          toolArgs: p.args ?? undefined, toolContext: p.context ?? p.preview ?? undefined, toolLabels: p.labels ?? undefined,
        };
        context.update({ messages: [...context.state().messages.filter((item) => item.id !== row.id), row] });
      }),
      client.on("tool.complete", (event) => {
        if (!own(event.session_id) || !event.payload) return;
        const p = event.payload;
        const row: ChatMessage = {
          id: "tool:" + p.tool_id, role: "tool", name: p.name,
          text: p.result_text ?? (p.result === undefined ? p.summary ?? "" : toolResultText(p.result)),
          status: toolResultFailed(p.result) ? "error" : "complete", resultSummary: p.summary ?? undefined,
          durationSeconds: p.duration_s ?? undefined,
          ...(p.args ? { toolArgs: p.args } : {}), ...(p.labels ? { toolLabels: p.labels } : {}),
        };
        if (context.state().messages.some((item) => item.id === row.id)) context.patchMessage(row.id, row);
        else context.update({ messages: [...context.state().messages, row] });
      }),
      client.on("notification.show", (event) => {
        if (own(event.session_id)) context.update({ notice: event.payload?.text ?? null });
      }),
      ...SUBAGENT_EVENTS.map((type) => client.on(type, (event) => {
        if (!own(event.session_id) || !event.payload) return;
        if (!event.payload.subagent_id) { void context.refreshSubagents(); return; }
        context.update({ subagents: applySubagentEvent(context.state().subagents, type, event.payload) });
      })),
  ];
}
