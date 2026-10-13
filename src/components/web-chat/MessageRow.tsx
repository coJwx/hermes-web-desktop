import { Bot, Check, Copy } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Markdown } from "@/components/Markdown";
import { useI18n } from "@/i18n";
import type { ChatMessage } from "@/lib/web-chat-state";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import { MessageImages } from "./MessageImages";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface MessageRowProps { message: ChatMessage; copy: WebChatCopy; profile?: string }

export function MessageRow({ message, copy, profile = "" }: MessageRowProps) {
  const { locale } = useI18n();
  const { copied, copyError, copyText } = useClipboardCopy(message.text);
  const copyButton = <Button ghost size="icon" aria-label={copied ? copy.copied : copy.copy} title={copied ? copy.copied : copy.copy}
    className="h-7 w-7 text-text-tertiary hover:text-text-primary" onClick={() => void copyText()}>
    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
  </Button>;

  if (message.role === "command") return <article aria-label={copy.command} className="min-w-0 pl-10">
    <div className="mb-2 font-mono text-xs text-text-secondary">{message.name}</div>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-current/10 bg-midground/[0.025] p-3 font-mono text-xs leading-relaxed">{message.text}</pre>
    <div className="mt-1">{copyButton}</div>
  </article>;

  if (message.role === "user") {
    const date = message.timestamp ? new Date(message.timestamp * 1000) : null;
    const validDate = date && Number.isFinite(date.getTime()) ? date : null;
    const today = validDate?.toDateString() === new Date().toDateString();
    const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
    return <article aria-label={copy.you} className="flex flex-col items-end gap-1.5">
      <div className="max-w-[90%] rounded-3xl bg-midground/[0.07] px-4 py-3 sm:max-w-[85%] sm:px-5 sm:py-4">
        {!!message.images?.length && <MessageImages images={message.images} profile={profile} copy={copy} />}
        {!!message.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>}
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
      <div className="break-words [overflow-wrap:anywhere] [&_h1]:text-blue-600 [&_h2]:text-blue-600 [&_h3]:text-blue-600 [&_h4]:text-blue-600 [&_a]:text-blue-600 [&_a]:decoration-blue-600/30 [&_:not(pre)>code]:bg-transparent [&_:not(pre)>code]:p-0 [&_:not(pre)>code]:text-sm [&_:not(pre)>code]:text-blue-600 dark:[&_h1]:text-blue-400 dark:[&_h2]:text-blue-400 dark:[&_h3]:text-blue-400 dark:[&_h4]:text-blue-400 dark:[&_a]:text-blue-400 dark:[&_:not(pre)>code]:text-blue-400">
        <Markdown content={message.text} streaming={message.status === "working"} />
      </div>
      {!!message.text && <div className="mt-2 flex items-center gap-2">
        {copyButton}
        {copyError && <span role="status" className="text-xs text-destructive">{copy.copyFailed}</span>}
      </div>}
    </div>
  </article>;
}
