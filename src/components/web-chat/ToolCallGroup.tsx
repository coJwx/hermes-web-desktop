import { useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toolCallTitle } from "@/lib/web-chat-activity";
import { toolResultText, type ChatMessage } from "@/lib/web-chat-state";
import type { WebChatCopy } from "@/lib/web-chat-copy";

interface ToolCallGroupProps { rows: ChatMessage[]; copy: WebChatCopy }

export function ToolCallGroup({ rows, copy }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const tools = rows.filter((row) => row.role === "tool");
  const reasoning = [...new Set(rows.map((row) => row.reasoning?.trim()).filter(Boolean))].join("\n\n");
  const running = tools.filter((row) => row.status === "working").length;
  const failures = tools.filter((row) => row.status === "error").length;

  return <details className="group/activity min-w-0 pl-10" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs text-text-secondary [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-open/activity:rotate-90" />
      <span>{tools.length ? copy.toolCalls + " (" + tools.length + ")" : reasoning ? copy.reasoning : copy.working}</span>
      {!!running && <span className="ml-auto flex items-center gap-1 text-primary"><LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />{copy.working}</span>}
      {!!failures && <span className="text-destructive">{copy.failed} · {failures}</span>}
    </summary>
    <div className="ml-1.5 mt-1 min-w-0 border-l border-midground/20 pl-3">
      {reasoning && <details className="mb-2 min-w-0 text-text-tertiary">
        <summary className="cursor-pointer text-[11px] leading-5">{copy.reasoning}</summary>
        <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{reasoning}</p>
      </details>}
      {rows.map((row) => row.role === "tool"
        ? <ToolCallRow key={row.id} tool={row} copy={copy} />
        : row.text.trim() ? <p key={row.id} className="mb-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary">{row.text}</p> : null)}
    </div>
  </details>;
}

interface ToolCallRowProps { tool: ChatMessage; copy: WebChatCopy }

function ToolCallRow({ tool, copy }: ToolCallRowProps) {
  const title = toolCallTitle(tool);
  const working = tool.status === "working";
  const failed = tool.status === "error";
  return <details className="group/tool relative min-w-0">
    <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md py-1 text-xs hover:bg-midground/5 [&::-webkit-details-marker]:hidden" title={title}>
      <span aria-hidden className="absolute -left-3 top-3 w-3 border-t border-midground/20" />
      {working ? <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 animate-spin text-primary" /> :
        <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-primary")} />}
      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{title}</span>
      {failed && <span className="shrink-0 text-destructive">{copy.failed}</span>}
      {tool.durationSeconds != null && <span className="shrink-0 font-mono text-[10px] text-text-tertiary">{tool.durationSeconds.toFixed(1)}s</span>}
      <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-text-tertiary transition-transform group-open/tool:rotate-90" />
    </summary>
    <div className="my-2 ml-3 space-y-3 rounded-lg border border-current/10 bg-midground/[0.025] p-3">
      <div><h4 className="mb-1 text-[11px] font-medium text-text-secondary">{copy.toolArguments}</h4>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{tool.toolArgs ? toolResultText(tool.toolArgs) : tool.toolContext || "—"}</pre>
      </div>
      <div><h4 className="mb-1 text-[11px] font-medium text-text-secondary">{copy.toolOutput}</h4>
        {tool.text ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{tool.text}</pre> :
          <p className="text-xs text-text-tertiary">{working ? copy.working : copy.toolResultUnavailable}</p>}
      </div>
      {tool.resultSummary && tool.resultSummary !== tool.text && <p className="text-xs text-text-secondary">{tool.resultSummary}</p>}
    </div>
  </details>;
}
