import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import type { ModelOptionsResult, SessionLiveInfo } from "@hermes/shared";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { errorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { webChatModelLabel, webChatModelProviders } from "@/lib/web-chat-models";
import type { WebChatController } from "@/lib/web-chat-controller";
import type { WebChatCopy } from "@/lib/web-chat-copy";

interface ModelCascaderProps {
  controller: WebChatController;
  info: SessionLiveInfo;
  sessionId: string | null;
  disabled: boolean;
  switching: boolean;
  copy: WebChatCopy;
}

interface PendingModelConfirm { provider: string; model: string; message: string; sessionId: string }

export function ModelCascader({ controller, info, sessionId, disabled, switching, copy }: ModelCascaderProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ModelOptionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingModelConfirm | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 440, height: 160 });
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const providerColumn = useRef<HTMLDivElement>(null);
  const modelColumn = useRef<HTMLDivElement>(null);
  const activeProvider = info.provider === "custom" ? catalog?.provider || info.provider : info.provider || catalog?.provider || "";
  const currentModel = info.model || catalog?.model || "";
  const label = webChatModelLabel(activeProvider, currentModel);
  const close = useCallback(() => { setOpen(false); setSelectedSlug(""); }, []);
  const providerRows = useMemo(() => webChatModelProviders(catalog?.providers || [], activeProvider, currentModel), [catalog, activeProvider, currentModel]);
  const selected = providerRows.find((provider) => provider.slug === selectedSlug) || providerRows.find((provider) => provider.slug === activeProvider || provider.aliases?.includes(activeProvider)) || providerRows[0];
  const modelRows = selected?.models || [];
  const rowCount = Math.max(3, providerRows.length, modelRows.length);

  useEffect(() => {
    if (disabled) { close(); setPendingConfirm(null); }
  }, [disabled, close]);

  useEffect(() => {
    if (!open || !sessionId) return;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    void controller.getModelOptions(false, abort.signal).then((result) => {
      if (!abort.signal.aborted) setCatalog(result);
    }).catch((cause) => {
      if (!abort.signal.aborted) setError(copy.modelOptionsFailed + " " + errorMessage(cause));
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, sessionId, controller, copy.modelOptionsFailed]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(440, window.innerWidth - 24);
      const height = Math.min(288, loading ? 88 : rowCount * 36 + 8, window.innerHeight - 24);
      setPosition({ width, height,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, loading, rowCount]);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); close(); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      anchor.current?.querySelector("button")?.focus();
    };
  }, [open, close]);

  useEffect(() => {
    if (open && !loading) providerColumn.current?.querySelector<HTMLButtonElement>("button[aria-checked=true]")?.focus();
  }, [open, loading]);

  const choose = async (provider: string, model: string, confirmed = false) => {
    if (disabled || switching || !sessionId) return;
    if (!confirmed && provider === activeProvider && model === currentModel) { close(); return; }
    setError(null);
    try {
      const result = await controller.switchModel(provider, model, confirmed);
      if (controller.getSnapshot().sessionId !== sessionId || !result) return;
      if (result.confirm_required) {
        setPendingConfirm({ provider, model, sessionId, message: result.confirm_message || result.warning || copy.modelConfirm });
        close();
      } else { setPendingConfirm(null); close(); }
    } catch (cause) {
      if (controller.getSnapshot().sessionId === sessionId) setError(errorMessage(cause));
    }
  };

  const columnKey = (event: KeyboardEvent<HTMLDivElement>, providersSide: boolean) => {
    if (event.nativeEvent.isComposing) return;
    const column = providersSide ? providerColumn.current : modelColumn.current;
    const buttons = Array.from(column?.querySelectorAll<HTMLButtonElement>("button[data-option]:not(:disabled)") || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -buttons.length, End: buttons.length };
    if (event.key in moves && buttons.length) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + moves[event.key] + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === (providersSide ? "ArrowRight" : "ArrowLeft")) {
      event.preventDefault();
      const other = providersSide ? modelColumn.current : providerColumn.current;
      (other?.querySelector<HTMLButtonElement>("button[data-option][aria-checked=true]:not(:disabled)") || other?.querySelector<HTMLButtonElement>("button[data-option]:not(:disabled)"))?.focus();
    }
  };

  return <div ref={anchor} className="min-w-0">
    <Button type="button" ghost size="sm" disabled={disabled || switching} title={label} aria-label={copy.switchModel + ": " + label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      className="flex h-7 min-w-0 max-w-full items-center gap-1 rounded-lg px-2 font-mono text-[11px] normal-case tracking-normal text-text-tertiary hover:text-text-primary"
      onClick={() => { if (open) close(); else setOpen(true); }}>
      <span className="min-w-0 truncate">{label}</span>
      {switching ? <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 animate-spin" /> : <ChevronDown aria-hidden className="h-3 w-3 shrink-0" />}
    </Button>
    {open && createPortal(<div ref={panel} id={id} role="menu" aria-label={copy.switchModel} aria-busy={loading || switching}
      style={{ ...position, position: "fixed", zIndex: 100 }}
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background-base font-sans text-text-primary shadow-lg">
      {error && <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">{error}</p>}
      {loading ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-xs text-text-secondary"><LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />{copy.loading}</div> :
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div ref={providerColumn} className="min-w-0 overflow-y-auto border-r border-border p-1" role="group" aria-label={copy.modelProviders} onKeyDown={(event) => columnKey(event, true)}>
            {providerRows.map((provider) => <button key={provider.slug} type="button" data-option role="menuitemradio" aria-checked={selected?.slug === provider.slug} disabled={switching}
              title={provider.name + " · " + provider.slug}
              className={cn("flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs hover:bg-midground/5 focus-visible:outline-2 focus-visible:outline-blue-500", selected?.slug === provider.slug && "bg-blue-500/15 font-medium text-blue-600 dark:text-blue-400")}
              onMouseEnter={() => { if (!switching) setSelectedSlug(provider.slug); }} onFocus={() => setSelectedSlug(provider.slug)} onClick={() => setSelectedSlug(provider.slug)}>
              <span className="min-w-0 flex-1 truncate">{provider.name}</span>
              <ChevronRight aria-hidden className="h-3 w-3 shrink-0" />
            </button>)}
          </div>
          <div ref={modelColumn} className="min-w-0 overflow-y-auto p-1" role="group" aria-label={copy.modelChoices} onKeyDown={(event) => columnKey(event, false)}>
            {!modelRows.length && <p className="px-3 py-4 text-xs text-text-tertiary">{copy.modelEmpty}</p>}
            {modelRows.map((model) => {
              const active = selected?.slug === activeProvider && model === currentModel;
              return <button key={model} type="button" data-option role="menuitemradio" aria-checked={active} disabled={switching || selected?.unavailable_models?.includes(model)} title={model}
                className={cn("flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs hover:bg-midground/5 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40", active && "bg-blue-500/15 text-blue-600 dark:text-blue-400")}
                onClick={() => { if (selected) void choose(selected.slug, model); }}>
                <span className="min-w-0 flex-1 truncate">{model}</span>{active && <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />}
              </button>;
            })}
          </div>
        </div>}
    </div>, document.body)}
    <ConfirmDialog open={!!pendingConfirm} title={copy.modelConfirm} description={pendingConfirm ? [pendingConfirm.message, error].filter(Boolean).join("\n\n") : undefined} loading={switching}
      confirmLabel={copy.modelConfirmAction} cancelLabel={copy.modelCancel} onCancel={() => setPendingConfirm(null)}
      onConfirm={() => { const pending = pendingConfirm; if (pending?.sessionId === sessionId) void choose(pending.provider, pending.model, true); }} />
  </div>;
}
