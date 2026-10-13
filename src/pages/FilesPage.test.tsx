// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FilesPage from "./FilesPage";
import { api, type ManagedFileEntry, type ManagedFileReadResponse } from "@/lib/api";
import { MAX_FILE_PREVIEW_BYTES } from "@/lib/file-preview";

vi.mock("@/contexts/usePageHeader", () => ({
  usePageHeader: () => ({ setAfterTitle: () => {}, setEnd: () => {} }),
}));
vi.mock("@/plugins", () => ({ PluginSlot: () => null }));

let root: Root;
let container: HTMLDivElement;
const entries: ManagedFileEntry[] = [
  { name: "photo.png", mime_type: "image/png", size: 12 },
  { name: "notes", mime_type: "application/octet-stream", size: 40 },
  { name: "utf16.txt", mime_type: "text/plain", size: 6 },
  { name: "program.bin", mime_type: "application/octet-stream", size: 4 },
  { name: "large.txt", mime_type: "text/plain", size: MAX_FILE_PREVIEW_BYTES + 1 },
].map((entry) => ({ ...entry, path: "/files/" + entry.name, is_directory: false, mtime: 0 }));

function response(entry: ManagedFileEntry, bytes: number[]): ManagedFileReadResponse {
  return { ...entry, size: bytes.length, mime_type: entry.mime_type!,
    data_url: `data:${entry.mime_type};base64,${btoa(String.fromCharCode(...bytes))}`,
    root: null, locked_root: null, can_change_path: true };
}

async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((node) => node.getAttribute("aria-label") === label);
  if (!button) throw new Error("Missing button " + label);
  await act(async () => { button.click(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(api, "listFiles").mockResolvedValue({ path: "/files", entries,
    parent: null, root: null, locked_root: null, can_change_path: true });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe("file preview interactions", () => {
  it("opens images and decoded text without downloading; only the download button saves a file", async () => {
    const text = '<script>alert("你好")</script>\nplain text';
    const replies = [response(entries[0], [137, 80, 78, 71]),
      response(entries[1], [...new TextEncoder().encode(text)]),
      response(entries[2], [255, 254, 45, 78, 135, 101])];
    const read = vi.spyOn(api, "readFile").mockImplementation(async (path) => replies.find((file) => file.path === path)!);
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => { root.render(<FilesPage />); });
    for (const entry of entries.slice(0, 3)) {
      await click("Preview: " + entry.name);
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain(entry.path);
      if (entry === entries[0]) expect(dialog.querySelector("img")?.getAttribute("src")).toBe(replies[0].data_url);
      else expect(dialog.querySelector("pre")?.textContent).toBe(entry === entries[1] ? text : "中文");
      expect(dialog.querySelector("script")).toBeNull();
      expect(download).not.toHaveBeenCalled();
      await click("Close");
    }
    expect(read).toHaveBeenCalledWith(entries[1].path);
    await click("Download " + entries[0].name);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("rejects binary and oversized previews, surfaces read errors, and ignores reads completed after closing", async () => {
    const read = vi.spyOn(api, "readFile").mockResolvedValue(response(entries[3], [0, 1, 2, 3]));
    await act(async () => { root.render(<FilesPage />); });
    await click("Preview: " + entries[3].name);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("binary");
    await click("Close");
    read.mockClear();
    await click("Preview: " + entries[4].name);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("5 MB");
    expect(read).not.toHaveBeenCalled();
    await click("Close");
    read.mockRejectedValueOnce(new Error("File not found"));
    await click("Preview: " + entries[1].name);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("File not found");
    await click("Close");
    let finish!: (file: ManagedFileReadResponse) => void;
    read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await click("Preview: " + entries[1].name);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { finish(response(entries[1], [65])); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
