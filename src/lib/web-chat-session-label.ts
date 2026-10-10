import type { SessionListRow } from "@hermes/shared";
import type { WebChatCopy } from "./web-chat-copy";
import { timeAgo } from "./utils";

/** Select labels stay strings; an explicit newline separates title from metadata. */
export function webChatSessionLabel(session: SessionListRow, copy: WebChatCopy): string {
  const title = (session.title || session.preview?.slice(0, 40) || copy.newChat).replace(/\s+/g, " ").trim();
  const metadata = [
    session.started_at && Number.isFinite(session.started_at) && session.started_at > 0 ? timeAgo(session.started_at) : null,
    typeof session.message_count === "number" && Number.isFinite(session.message_count) && session.message_count >= 0
      ? copy.sessionMessages.replace("{count}", String(session.message_count)) : null,
    session.source?.replace(/\s+/g, " ").trim(),
  ].filter(Boolean);
  return metadata.length ? title + "\n" + metadata.join(" · ") : title;
}
