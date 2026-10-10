// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Modal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  it("contains keyboard/programmatic focus, preserves it on rerender, and restores the trigger", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const render = () => <Modal open onClose={() => {}} title="Focus" showCloseButton={false}>
      <button>First</button><input aria-label="Draft" /><button>Last</button>
    </Modal>;
    act(() => root.render(render()));
    const dialog = document.querySelector('[role="dialog"]')!;
    const [first, last] = dialog.querySelectorAll("button");
    const input = dialog.querySelector("input")!;
    expect(document.activeElement).toBe(first);
    input.focus();
    act(() => root.render(render()));
    expect(document.activeElement).toBe(input);
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    trigger.focus();
    expect(document.activeElement).toBe(first);
    act(() => root.render(<Modal open={false} onClose={() => {}}>Closed</Modal>));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("only dismisses the top dialog and keeps scrolling locked until every dialog closes", () => {
    document.body.style.overflow = "auto";
    const closed = vi.fn();
    function Nested() {
      const [confirm, setConfirm] = useState(false);
      const [busy, setBusy] = useState(false);
      const [legacy, setLegacy] = useState(false);
      useEffect(() => {
        if (!legacy) return;
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") setLegacy(false); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
      }, [legacy]);
      return <>
        <Modal open title="Outer" closeDisabled={busy} onClose={closed}>
          <button onClick={() => setConfirm(true)}>Nested</button>
          <button onClick={() => setBusy(true)}>Save</button>
          <button onClick={() => setLegacy(true)}>Legacy picker</button>
        </Modal>
        <ConfirmDialog open={confirm} title="Inner" onConfirm={() => {}} onCancel={() => setConfirm(false)} />
        {legacy && <div role="dialog" aria-modal="true" style={{ zIndex: 101 }}><input aria-label="Legacy choice" /></div>}
      </>;
    }
    act(() => root.render(<Nested />));
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent === "Nested")!;
    trigger.focus();
    act(() => trigger.click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(closed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Legacy picker")!.click());
    const legacyInput = document.querySelector<HTMLInputElement>('[aria-label="Legacy choice"]')!;
    legacyInput.focus();
    expect(document.activeElement).toBe(legacyInput);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(closed).not.toHaveBeenCalled();
    act(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(closed).not.toHaveBeenCalled();
    act(() => root.render(null));
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("renders when open and mounts directly into document.body", () => {
    act(() => {
      root.render(
        <Modal open={true} onClose={() => {}} title="Test Modal" subtitle="Subtitle Info">
          <div>Modal Content</div>
        </Modal>
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.body.textContent).toContain("Test Modal");
    expect(document.body.textContent).toContain("Subtitle Info");
    expect(document.body.textContent).toContain("Modal Content");
  });

  it("does not render into document.body when closed", () => {
    act(() => {
      root.render(
        <Modal open={false} onClose={() => {}} title="Test Modal">
          <div>Modal Content</div>
        </Modal>
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal open={true} onClose={onClose} title="Closeable">
          <div>Content</div>
        </Modal>
      );
    });

    const closeBtn = document.body.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal open={true} onClose={onClose} title="Escape Modal">
          <div>Content</div>
        </Modal>
      );
    });

    act(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking outside", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Modal open={true} onClose={onClose} title="Backdrop Modal">
          <div>Content</div>
        </Modal>
      );
    });

    const backdrop = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(backdrop).not.toBeNull();

    act(() => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      backdrop.dispatchEvent(event);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
