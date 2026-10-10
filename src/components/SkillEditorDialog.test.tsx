// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillEditorDialog } from "./SkillEditorDialog";
import { input, json, mountEditor, press, profileResponse, setupEditorDOM, unloadPrevented } from "@/test/editor-test-utils";

let app: Awaited<ReturnType<typeof mountEditor>>;
let failLoad: boolean;
let failSave: boolean;
let holdSave: boolean;
let completeSave: (() => void) | undefined;
const saved = vi.fn();

function Editor({ editName }: { editName: string | null }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open editor</button>
    <SkillEditorDialog open={open} editName={editName} profile="A" onClose={() => setOpen(false)} onSaved={saved} />
  </>;
}

beforeEach(() => {
  setupEditorDOM();
  failLoad = failSave = holdSave = false;
  saved.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const profiles = profileResponse(path);
    if (profiles) return profiles;
    if (init?.method === "POST" || init?.method === "PUT") {
      if (holdSave) await new Promise<void>((resolve) => { completeSave = resolve; });
      return failSave ? json({ detail: "Write failed" }, 503) : json({ ok: true });
    }
    if (path === "/api/skills/content") return failLoad ? json({ detail: "Read failed" }, 503) : json({ content: "# Original" });
    throw new Error("Unexpected request " + url);
  }));
});

afterEach(async () => {
  await app?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const content = () => document.querySelector<HTMLTextAreaElement>("#skill-editor-content")!;
const escape = async () => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

describe("skill draft protection", () => {
  it("protects new drafts on Escape, close, backdrop, navigation, and failed saves", async () => {
    app = await mountEditor(<Editor editName={null} />);
    const trigger = [...document.querySelectorAll("button")].find((button) => button.textContent === "Open editor")!;
    trigger.focus();
    await press("Open editor");
    // Footer is available on the first render, without a second render to discover a portal target.
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Create")).toBe(true);
    expect(unloadPrevented()).toBe(false);
    await input(document.querySelector<HTMLInputElement>("#skill-editor-name")!, "draft-skill");
    await input(content(), "# Draft");
    expect(unloadPrevented()).toBe(true);
    await escape();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await escape();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(content().value).toBe("# Draft");
    await press("Close");
    await press("Keep editing");
    await act(async () => { document.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await press("Keep editing");
    await press("Leave editor");
    await press("Keep editing");
    expect(content().value).toBe("# Draft");
    failSave = true;
    await press("Create");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Write failed");
    expect(content().value).toBe("# Draft");
    expect(saved).not.toHaveBeenCalled();
    await press("Cancel");
    await press("Discard and continue");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(unloadPrevented()).toBe(false);
  });

  it("retries failed reads and blocks dismissal while a successful save is pending", async () => {
    failLoad = true;
    app = await mountEditor(<Editor editName="existing" />);
    await press("Open editor");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Read failed");
    await press("Save");
    expect(saved).not.toHaveBeenCalled();
    failLoad = false;
    await press("Retry");
    expect(content().value).toBe("# Original");
    await input(content(), "# Updated");
    holdSave = true;
    await press("Save");
    await escape();
    await press("Close");
    expect(content().value).toBe("# Updated");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => { completeSave!(); });
    expect(saved).toHaveBeenCalledWith("existing");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(unloadPrevented()).toBe(false);
  });
});
