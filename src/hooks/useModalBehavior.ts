import { useLayoutEffect, useRef } from "react";

interface DialogEntry {
  container: HTMLElement;
  restoreFocus: HTMLElement | null;
}

const dialogs: DialogEntry[] = [];
let bodyOverflow = "";

function topDialog(exclude?: Element | null) {
  // Older pickers also portal role=dialog surfaces without this hook. Defer to
  // them rather than trapping their focus or swallowing their Escape listener.
  const visible = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter((dialog) => dialog !== exclude && !dialog.hidden && getComputedStyle(dialog).display !== "none");
  return visible.reduce<HTMLElement | undefined>((top, dialog) => {
    if (!top) return dialog;
    const layer = (el: HTMLElement) => Number(getComputedStyle(el.closest('[role="dialog"]') ?? el).zIndex) || 0;
    if (layer(dialog) !== layer(top)) return layer(dialog) > layer(top) ? dialog : top;
    return top.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING ? dialog : top;
  }, undefined);
}

function ownsFocus(container: HTMLElement) {
  return topDialog() === (container.closest('[role="dialog"]') ?? container);
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
  )).filter((el) => {
    if (el.tabIndex < 0 || el.matches(':disabled, input[type="hidden"]')) return false;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert || style.display === "none" || style.visibility === "hidden") return false;
      if (node === container) break;
    }
    return true;
  });
}

/** Share focus and scroll ownership so closing a nested dialog cannot unlock its parent. */
export function useModalBehavior({ open, onClose }: { open: boolean; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    const entry: DialogEntry = { container, restoreFocus: document.activeElement as HTMLElement | null };
    const previousTabIndex = container.getAttribute("tabindex");
    container.tabIndex = -1;
    if (!dialogs.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogs.push(entry);

    const focusFirst = () => {
      const elements = focusableElements(container);
      (elements.find((el) => el.hasAttribute("data-autofocus") || el.hasAttribute("autofocus")) ?? elements[0] ?? container).focus();
    };
    if (ownsFocus(container) && !container.contains(document.activeElement)) focusFirst();

    const onFocus = (event: FocusEvent) => {
      if (ownsFocus(container) && !container.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!ownsFocus(container)) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(container);
      const first = elements[0] ?? container;
      const last = elements.at(-1) ?? container;
      if (!elements.length || !container.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last) ||
          document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      dialogs.splice(dialogs.indexOf(entry), 1);
      // Discard can close an editor and its confirmation in one commit. Pass
      // the editor's trigger through the confirmation instead of restoring a removed input.
      for (const remaining of dialogs) {
        if (remaining.restoreFocus && container.contains(remaining.restoreFocus)) {
          remaining.restoreFocus = entry.restoreFocus;
        }
      }
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      if (previousTabIndex === null) container.removeAttribute("tabindex");
      else container.setAttribute("tabindex", previousTabIndex);
      if (!dialogs.length) document.body.style.overflow = bodyOverflow;
      // An open=false render can remove the portal before this cleanup runs.
      // Restore into the remaining top dialog, never into a covered background.
      const remaining = topDialog(container.closest('[role="dialog"]'));
      const previous = entry.restoreFocus;
      if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus();
    };
  }, [open]);

  return containerRef;
}
