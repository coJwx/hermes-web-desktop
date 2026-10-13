import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import type { CompletionItem } from "@hermes/shared";
import type { WebChatCopy } from "@/lib/web-chat-copy";
import { cn } from "@/lib/utils";

interface SlashCompletionMenuProps {
  id: string;
  items: CompletionItem[];
  selected: number;
  replaceFrom: number;
  loading: boolean;
  error: string | null;
  copy: WebChatCopy;
  onChoose: (index: number) => void;
  onHighlight: (index: number) => void;
}

export function SlashCompletionMenu({ id, items, selected, replaceFrom, loading, error, copy, onChoose, onHighlight }: SlashCompletionMenuProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.children.item(selected)?.scrollIntoView({ block: "nearest" }); }, [selected, items]);
  return <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 overflow-hidden rounded-xl border border-midground/20 bg-background-base shadow-lg">
    <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2 text-xs text-text-secondary">
      <span className="font-medium">{copy.commandMenu}</span>
      {loading && <LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />}
      <span className="ml-auto hidden text-[10px] text-text-tertiary sm:inline">{copy.commandHint}</span>
    </div>
    {error && <p role="status" className="px-3 py-2 text-xs text-warning">{copy.commandCompletionFailed} {error}</p>}
    <div ref={list} id={id} role="listbox" aria-label={copy.commandMenu} className="max-h-[min(20rem,35dvh)] overflow-y-auto p-1">
      {items.map((item, index) => {
        const display = item.display || item.text;
        const label = replaceFrom <= 1 && !display.startsWith("/") ? "/" + display : display;
        return <button type="button" role="option" id={id + "-" + index} key={item.text + ":" + index} tabIndex={-1}
          aria-selected={index === selected}
          className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors", index === selected ? "bg-midground/10" : "hover:bg-midground/5")}
          onMouseDown={(event) => event.preventDefault()} onClick={() => onChoose(index)} onMouseEnter={() => onHighlight(index)}>
          <span className="min-w-0 max-w-[45%] shrink-0 break-words font-mono text-xs text-text-primary">{label}</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{item.meta}</span>
          {item.kind === "skill" && <span className="shrink-0 rounded border border-current/15 px-1 text-[10px] text-text-tertiary">skill</span>}
        </button>;
      })}
    </div>
  </div>;
}
