import type { ChatMessage } from "./web-chat-state";

interface MessageBlock { kind: "message"; id: string; message: ChatMessage }
interface ActivityBlock { kind: "activity"; id: string; rows: ChatMessage[] }
export type ChatTranscriptBlock = MessageBlock | ActivityBlock;

/** Keep public replies in order; fold internal steps into one compact activity trail. */
export function groupChatTranscript(messages: ChatMessage[]): ChatTranscriptBlock[] {
  const blocks: ChatTranscriptBlock[] = [];
  let activity: ChatMessage[] = [];
  const flush = () => {
    if (!activity.length) return;
    blocks.push({ kind: "activity", id: "activity:" + (activity.find((row) => row.role === "tool")?.id ?? activity[0].id), rows: activity });
    activity = [];
  };
  messages.forEach((row, index) => {
    const terminalFailure = row.status === "error" || row.status === "interrupted";
    const internalAssistant = row.role === "assistant" && !terminalFailure &&
      (!row.text.trim() || (!row.status && messages[index + 1]?.role === "tool"));
    if (row.role === "tool" || row.role === "commentary" || internalAssistant) {
      if (row.role === "tool" || row.text.trim() || row.reasoning?.trim()) activity.push(row);
      return;
    }
    flush();
    blocks.push({ kind: "message", id: row.id, message: row });
  });
  flush();
  return blocks;
}

const PREVIEW_FIELDS = ["command", "path", "file_path", "pattern", "query", "url"];

export function toolCallTitle(row: ChatMessage): string {
  if (row.toolLabels?.length) {
    return row.toolLabels.map((label) => label.text + (label.preview ? " (" + label.preview + ")" : "")).join(" · ");
  }
  const name = (row.name ?? "tool").split("_").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  const args = row.toolArgs ?? {};
  const argument = PREVIEW_FIELDS.map((field) => args[field]).find((value) => typeof value === "string" && value.trim());
  // Commands benefit from the untruncated argument; server context preserves file line ranges.
  const preview = (typeof args.command === "string" ? args.command : row.toolContext || (typeof argument === "string" ? argument : ""))
    .replace(/\s+/g, " ").trim();
  const compact = preview.length > 180 ? preview.slice(0, 180) + "…" : preview;
  return compact ? name + "(" + JSON.stringify(compact) + ")" : name;
}

export function toolResultFailed(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const payload = result as Record<string, unknown>;
  return !!payload.error || payload.success === false || (typeof payload.exit_code === "number" && payload.exit_code !== 0);
}
