import { Check, Copy } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { useI18n } from "@/i18n";
import { markdownLanguageLabel } from "@/lib/markdown-presentation";
import { useClipboardCopy } from "@/hooks/useClipboardCopy";

interface MarkdownCodeBlockProps {
  text: string;
  language: string;
  streaming: boolean;
}

export function MarkdownCodeBlock({ text, language, streaming }: MarkdownCodeBlockProps) {
  const { locale } = useI18n();
  const { copied, copyError, copyText } = useClipboardCopy(text);
  const zh = locale.startsWith("zh");
  const copyLabel = copied ? (zh ? "已复制" : "Copied") : (zh ? "复制代码" : "Copy code");
  return <div className="overflow-hidden rounded-2xl border border-border/60 bg-secondary">
    <div className="flex items-center justify-between gap-3 px-4 pt-2 text-xs text-text-tertiary">
      <span className="font-sans">{markdownLanguageLabel(language) || (zh ? "代码" : "Code")}</span>
      <Button type="button" ghost size="icon" className="h-7 w-7 rounded-md p-0 [&>svg]:size-3.5" aria-label={copyLabel} title={copyLabel} onClick={() => void copyText()}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
    <pre className="overflow-x-auto px-4 pb-4 pt-2 text-xs font-mono leading-relaxed text-foreground">
      <code>{text}{streaming && <span aria-hidden className="markdown-streaming-caret" />}</code>
    </pre>
    {copyError && <p role="status" className="px-4 pb-2 text-xs text-destructive">{zh ? "无法复制代码" : "Could not copy code"}</p>}
  </div>;
}
