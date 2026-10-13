import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { CompleteSlashResult, CompletionItem } from "@hermes/shared";
import type { WebChatController } from "@/lib/web-chat-controller";
import { errorMessage } from "@/lib/api-error";
import { applySlashCompletion, slashCompletionQuery, type SlashCompletionEdit } from "@/lib/web-chat-completion";

interface CompletionSnapshot { key: string; items: CompletionItem[]; replaceFrom: number; loading: boolean; error: string | null }
interface SlashCompletionOptions { value: string; cursor: number; enabled: boolean; sessionId: string | null; controller: WebChatController }

export function useSlashCompletion({ value, cursor, enabled, sessionId, controller }: SlashCompletionOptions) {
  const id = "web-chat-slash-" + useId();
  const query = enabled ? slashCompletionQuery(value, cursor) : null;
  const key = (sessionId ?? "") + ":" + (query ?? "");
  const [snapshot, setSnapshot] = useState<CompletionSnapshot>({ key: "", items: [], replaceFrom: 1, loading: false, error: null });
  const [selected, setSelected] = useState({ key: "", index: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (query === null || !sessionId || dismissed === key) return;
    const abort = new AbortController();
    setSnapshot({ key, items: [], replaceFrom: 1, loading: true, error: null });
    const timer = setTimeout(() => {
      void controller.requestSession<CompleteSlashResult>("complete.slash", { text: query }, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setSnapshot({ key, items: (result.items ?? []).filter((item) => typeof item.text === "string"), replaceFrom: result.replace_from ?? 1, loading: false, error: null });
        })
        .catch((error) => {
          if (!abort.signal.aborted) setSnapshot({ key, items: [], replaceFrom: 1, loading: false, error: errorMessage(error) });
        });
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, key, sessionId, controller, dismissed]);

  const items = snapshot.key === key ? snapshot.items : [];
  const loading = snapshot.key === key ? snapshot.loading : query !== null;
  const error = snapshot.key === key ? snapshot.error : null;
  const index = Math.min(selected.key === key ? selected.index : 0, Math.max(0, items.length - 1));
  const visible = query !== null && dismissed !== key && (loading || !!error || !!items.length);
  const dismiss = () => setDismissed(key);
  const choose = (position: number): SlashCompletionEdit | null => {
    const item = items[position];
    if (!item) return null;
    dismiss();
    return applySlashCompletion(value, cursor, snapshot.replaceFrom, item.text);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, apply: (edit: SlashCompletionEdit) => void): boolean => {
    if (!visible || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "Escape") { event.preventDefault(); dismiss(); return true; }
    if (!items.length) return false;
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setSelected({ key, index: (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length });
      return true;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      const edit = applySlashCompletion(value, cursor, snapshot.replaceFrom, items[index].text);
      // An exact command should execute on Enter, rather than requiring another Enter just for a space.
      if (event.key === "Enter" && edit.value.trimEnd() === value.trimEnd()) { dismiss(); return false; }
      event.preventDefault();
      dismiss();
      apply(edit);
      return true;
    }
    return false;
  };
  return { id, items, index, visible, loading, error, replaceFrom: snapshot.replaceFrom, dismiss, choose, handleKeyDown,
    highlight: (position: number) => setSelected({ key, index: position }),
    reopen: () => setDismissed(null),
  };
}
