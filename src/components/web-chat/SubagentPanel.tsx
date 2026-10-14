import { useId } from "react";
import { ChevronRight, GitFork, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { subagentFinished, type WebChatSubagent } from "@/lib/web-chat-subagents";
import { useSubagentRoster } from "@/hooks/useSubagentRoster";
import { useSubagentTail } from "@/hooks/useSubagentTail";
import type { WebChatController } from "@/lib/web-chat-controller";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import type { SubagentStatus } from "@hermes/shared";

interface SubagentPanelProps {
  controller: WebChatController;
  sessionId: string | null;
  connected: boolean;
  rows: WebChatSubagent[];
  error: string | null;
  unsupported: boolean;
  copy: WebChatCopy;
}

const STATUS_COPY: Record<SubagentStatus, keyof WebChatCopy> = {
  queued: "subagentQueued", running: "subagentRunning", completed: "subagentCompleted", failed: "subagentFailed",
  error: "subagentFailed", timeout: "subagentTimeout", interrupted: "subagentInterrupted",
};

export function SubagentPanel({ controller, sessionId, connected, rows, error, unsupported, copy }: SubagentPanelProps) {
  const id = useId();
  const view = controller.getSnapshot().view;
  const expanded = view?.details.subagents ?? false;
  const selected = view?.subagent ?? null;
  const setExpanded = (next: boolean) => controller.patchState({ view: { ...view, details: { ...view?.details, subagents: next } } });
  const setSelected = (next: string | null) => controller.patchState({ view: { ...view, details: view?.details ?? {}, subagent: next } });
  useSubagentRoster(controller, sessionId, connected);
  const running = rows.filter((row) => row.available && !subagentFinished(row) && (row.status === "running" || row.status === "queued")).length;
  const active = rows.find((row) => row.subagent_id === selected);
  if (!rows.length && !error) return null;

  return <section aria-label={copy.subagents} className="mb-2 min-w-0 rounded-xl border border-current/10 bg-midground/[0.025]">
    <button type="button" aria-expanded={expanded} aria-controls={expanded ? id : undefined} onClick={() => setExpanded(!expanded)}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-text-secondary hover:bg-midground/5 focus-visible:outline-2 focus-visible:outline-blue-500">
      <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
      <GitFork aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>{copy.subagents} · {rows.length}</span>
      {!!running && <span role="status" className="ml-auto flex items-center gap-1.5 text-blue-600 dark:text-blue-400"><LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />{copy.subagentRunning} · {running}</span>}
    </button>
    {expanded && <div id={id} className="max-h-[32dvh] space-y-1 overflow-y-auto border-t border-current/10 p-2">
      {error && <p role="status" className="px-2 py-1 text-xs text-warning">{copy.subagentListError}: {error}</p>}
      {unsupported && <p className="px-2 py-1 text-xs text-text-tertiary">{copy.subagentEventsOnly}</p>}
      {rows.map((row) => {
        const terminal = subagentFinished(row);
        const unknown = !row.available && !terminal;
        const failed = ["failed", "error", "timeout"].includes(row.status || "");
        const label = unknown || !row.status ? copy.subagentUnknown : copy[STATUS_COPY[row.status]];
        const rowId = id + "-" + row.subagent_id;
        return <div key={row.subagent_id}>
          <button type="button" aria-expanded={selected === row.subagent_id} aria-controls={selected === row.subagent_id ? rowId : undefined}
            className={cn("flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-midground/5 focus-visible:outline-2 focus-visible:outline-blue-500", selected === row.subagent_id && "bg-midground/5")}
            onClick={() => setSelected(selected === row.subagent_id ? null : row.subagent_id)}>
            <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", unknown ? "bg-midground/30" : failed ? "bg-destructive" : terminal ? "bg-success" : "bg-blue-500")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium" title={row.goal || copy.subagentTask}>{row.goal || copy.subagentTask}</span>
              <span className="mt-1 block truncate font-mono text-[10px] text-text-tertiary">
                {[row.subagent_id, row.model, copy.subagentTools.replace("{count}", String(row.tool_count || 0))].filter(Boolean).join(" · ")}
              </span>
              {row.last_tool && <span className="mt-0.5 block truncate text-[10px] text-text-tertiary">{copy.subagentLastTool}: {row.last_tool}</span>}
            </span>
            <span className={cn("shrink-0 text-[11px]", failed ? "text-destructive" : "text-text-secondary")}>{label}</span>
            <ChevronRight aria-hidden className={cn("mt-0.5 h-3 w-3 shrink-0 text-text-tertiary", selected === row.subagent_id && "rotate-90")} />
          </button>
          {selected === row.subagent_id && sessionId && active && <SubagentDetail key={row.subagent_id} id={rowId} row={active} controller={controller} sessionId={sessionId} connected={connected} copy={copy} />}
        </div>;
      })}
    </div>}
  </section>;
}

interface SubagentDetailProps {
  id: string; row: WebChatSubagent; controller: WebChatController; sessionId: string; connected: boolean; copy: WebChatCopy;
}

function SubagentDetail({ id, row, controller, sessionId, connected, copy }: SubagentDetailProps) {
  const tail = useSubagentTail(controller, sessionId, row.subagent_id, connected, row.available && !subagentFinished(row));
  return <div id={id} className="mx-2 mb-2 space-y-2 rounded-lg border border-current/10 p-3 text-xs">
    <p className="whitespace-pre-wrap break-words leading-relaxed">{row.goal || copy.subagentTask}</p>
    {row.summary && <div><h4 className="mb-1 text-[11px] font-medium text-text-secondary">{copy.subagentSummary}</h4><p className="whitespace-pre-wrap break-words leading-relaxed">{row.summary}</p></div>}
    {row.activity && <p className="max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-tertiary">{row.activity}</p>}
    <h4 className="text-[11px] font-medium text-text-secondary">{copy.subagentLog}</h4>
    {tail.error && <p role="status" className="text-warning">{tail.error}</p>}
    {tail.truncated && <p className="text-[11px] text-text-tertiary">{copy.subagentTruncated}</p>}
    {!tail.available && !tail.loading && <p className="text-[11px] text-text-tertiary">{tail.text ? copy.subagentLogRetained : copy.subagentLogUnavailable}</p>}
    {tail.loading && connected ? <p role="status" className="flex items-center gap-2 text-text-tertiary"><LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />{copy.loading}</p> :
      tail.text && <pre className="max-h-[20dvh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{tail.text}</pre>}
    {!connected && <p role="status" className="text-[11px] text-text-tertiary">{copy.disconnected}</p>}
  </div>;
}
