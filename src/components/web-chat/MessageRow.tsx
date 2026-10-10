import { useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Markdown } from "@/components/Markdown";
import { useI18n } from "@/i18n";
import type { ChatMessage } from "@/lib/web-chat-state";
import type { WebChatCopy } from "@/lib/web-chat-copy";

interface MessageRowProps { message: ChatMessage; copy: WebChatCopy }

export function MessageRow({ message, copy }: MessageRowProps) {
  const { locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyText = async () => {
    try { await navigator.clipboard.writeText(message.text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  const copyButton = <Button ghost size="icon" aria-label={copied ? copy.copied : copy.copy} title={copied ? copy.copied : copy.copy}
    className="h-7 w-7 text-text-tertiary hover:text-text-primary" onClick={() => void copyText()}>
    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
  </Button>;

  if (message.role === "user") {
    const date = message.timestamp ? new Date(message.timestamp * 1000) : null;
    const validDate = date && Number.isFinite(date.getTime()) ? date : null;
    const today = validDate?.toDateString() === new Date().toDateString();
    const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
    return <article aria-label={copy.you} className="flex flex-col items-end gap-1.5">
      <div className="max-w-[90%] rounded-3xl bg-midground/[0.07] px-4 py-3 sm:max-w-[85%] sm:px-5 sm:py-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>
      </div>
      <div className="flex items-center justify-end gap-2 px-1 text-xs text-text-tertiary">
        {validDate && <time dateTime={validDate.toISOString()} title={validDate.toLocaleString(locale)}>
          {today ? validDate.toLocaleTimeString(locale, timeOptions) :
            validDate.toLocaleString(locale, { ...timeOptions, year: "numeric", month: "2-digit", day: "2-digit" })}
        </time>}
        {!!message.text && copyButton}
        {copyError && <span role="status">{copy.copyFailed}</span>}
      </div>
    </article>;
  }
  return <article aria-label="Hermes" className="group flex gap-3">
    <span aria-hidden className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-midground/20 text-midground"><Bot className="h-4 w-4" /></span>
    <div className="min-w-0 flex-1 py-1">
      <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
        <span className="font-semibold">Hermes</span>
        {message.role === "commentary" && <span className="text-text-tertiary">{copy.working}</span>}
        {message.status === "interrupted" && <span>{copy.interrupted}</span>}
        {message.status === "error" && <span className="text-destructive">{copy.failed}</span>}
      </div>
      {message.reasoning && <details className="mb-3 rounded-lg border border-current/10 px-3 py-2 text-text-secondary">
        <summary className="cursor-pointer text-xs">{copy.reasoning}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{message.reasoning}</p>
      </details>}
      <div className="break-words [overflow-wrap:anywhere]"><Markdown content={message.text} streaming={message.status === "working"} /></div>
      {!!message.text && <div className="mt-2 flex items-center gap-2">
        {copyButton}
        {copyError && <span role="status" className="text-xs text-destructive">{copy.copyFailed}</span>}
      </div>}
    </div>
  </article>;
}
