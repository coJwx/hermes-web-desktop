import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { flushSync } from "react-dom";
import { Button } from "@nous-research/ui/ui/components/button";
import { Modal } from "@/components/Modal";
import { useI18n } from "@/i18n";
import { en } from "@/i18n/en";
import { installDesktopLeaveHandler } from "@/lib/desktop-leave";
import { UnsavedChangesContext, type DraftState } from "./unsaved-changes-context";

/** One router blocker owns all editor guards; profile changes are confirmed before retargeting writes. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, DraftState>());
  const bypass = useRef(false);
  const nativeCancel = useRef<(() => void) | null>(null);
  const nativeApproved = useRef(false);
  const [state, setState] = useState<DraftState>({ dirty: false, busy: false });
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [nativeLeaving, setNativeLeaving] = useState(false);
  const { t } = useI18n();
  const copy = { ...en.common, ...t.common };



  const setDraft = useCallback((id: string, next: DraftState | null) => {
    if (next?.dirty || next?.busy) drafts.current.set(id, next);
    else drafts.current.delete(id);
    const values = [...drafts.current.values()];
    const dirty = values.some((entry) => entry.dirty);
    const busy = values.some((entry) => entry.busy);
    setState((prev) => prev.dirty === dirty && prev.busy === busy ? prev : { dirty, busy });
  }, []);

  const confirmDiscard = useCallback((action: () => void) => {
    const values = [...drafts.current.values()];
    if (values.some((entry) => entry.busy)) return;
    if (values.some((entry) => entry.dirty)) setPending(() => action);
    else action();
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypass.current || !drafts.current.size) return false;
    // Query-only UI changes are safe; a profile change remounts the editor.
    return currentLocation.pathname !== nextLocation.pathname ||
      new URLSearchParams(currentLocation.search).get("profile") !==
      new URLSearchParams(nextLocation.search).get("profile");
  });
  const blockerRef = useRef(blocker);
  useEffect(() => { blockerRef.current = blocker; }, [blocker]);

  useEffect(() => installDesktopLeaveHandler({
    readState: () => ({
      dirty: [...drafts.current.values()].some((draft) => draft.dirty),
      busy: [...drafts.current.values()].some((draft) => draft.busy),
    }),
    confirm: (accept, reject) => {
      if (blockerRef.current.state === "blocked") blockerRef.current.reset();
      nativeCancel.current = reject;
      setPending(() => () => { nativeCancel.current = null; accept(); });
    },
    cancel: () => { nativeCancel.current = null; setPending(null); },
    approved: (value) => {
      // Freeze input before the local HTTP reply lets native destruction start.
      flushSync(() => { nativeApproved.current = value; setNativeLeaving(value); });
    },
  }), []);

  useEffect(() => {
    if (!state.dirty && !state.busy) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      if (nativeApproved.current) { nativeApproved.current = false; return; }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [state.dirty, state.busy]);

  useEffect(() => {
    if (blocker.state === "blocked" && !state.dirty && !state.busy) blocker.proceed();
  }, [blocker, state.dirty, state.busy]);

  const cancel = () => {
    nativeCancel.current?.();
    nativeCancel.current = null;
    setPending(null);
    if (blocker.state === "blocked") blocker.reset();
  };
  const discard = () => {
    if (state.busy) return;
    setPending(null);
    if (nativeCancel.current && pending) {
      nativeCancel.current = null;
      pending();
      return;
    }
    if (blocker.state === "blocked") blocker.proceed();
    else if (pending) {
      // A profile setter navigates synchronously; do not prompt a second time for that navigation.
      bypass.current = true;
      try { pending(); } finally { bypass.current = false; }
    }
  };
  const value = useMemo(() => ({ setDraft, confirmDiscard }), [setDraft, confirmDiscard]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <Modal open={nativeLeaving || pending !== null || blocker.state === "blocked"} onClose={cancel}
        closeDisabled={nativeLeaving}
        title={nativeLeaving ? t.common.loading : state.busy ? t.common.saving : copy.unsavedTitle}
        size="sm" zIndex={300} showCloseButton={false}
        footer={nativeLeaving ? undefined : <>
          <Button data-autofocus outlined onClick={cancel}>{copy.keepEditing}</Button>
          {!state.busy && <Button destructive onClick={discard}>{copy.discardChanges}</Button>}
        </>}
      >
        <p className="text-sm text-muted-foreground">{nativeLeaving ? t.common.loading : state.busy ? copy.waitForSave : copy.unsavedDescription}</p>
      </Modal>
    </UnsavedChangesContext.Provider>
  );
}
