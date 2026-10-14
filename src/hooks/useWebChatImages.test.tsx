// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useWebChatImages } from "./useWebChatImages";
import { webChatCopy } from "@/lib/web-chat-copy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("enforces the shared File budget across rapid additions, isolates scopes and releases each owned URL", async () => {
  const created: string[] = []; const revoked: string[] = [];
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { const url = "blob:test-" + created.length; created.push(url); return url; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  });
  let images!: ReturnType<typeof useWebChatImages>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Harness({ scope }: { scope: string }) { images = useWebChatImages(scope, webChatCopy("en")); return <span>{images.images.length}</span>; }
  const file = (name: string) => { const file = new File(["x"], name, { type: "image/png" }); Object.defineProperty(file, "size", { value: 25 * 1024 ** 2 }); return file; };
  await act(async () => { root.render(<Harness scope="A" />); });
  await act(async () => { images.add([file("1.png"), file("2.png")]); images.add([file("3.png"), file("4.png")]); });
  expect(images.images).toHaveLength(4);
  await act(async () => { root.render(<Harness scope="B" />); });
  await act(async () => { images.add([file("5.png")]); });
  expect(images.images).toHaveLength(0); expect(images.error).toContain("100 MiB"); expect(created).toHaveLength(4);
  await act(async () => { root.render(<Harness scope="A" />); });
  await act(async () => { images.remove([images.images[0].id]); });
  await act(async () => { root.render(<Harness scope="B" />); });
  await act(async () => { images.add([file("5.png")]); });
  expect(images.images).toHaveLength(1);
  await act(async () => { root.unmount(); }); host.remove();
  expect(new Set(revoked)).toEqual(new Set(created)); expect(revoked).toHaveLength(created.length);
});

it("keeps open scopes protected while pruning the ninth closed draft and migrates a resolved stored identity", async () => {
  const revoked: string[] = []; let next = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:owned-" + next++; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  });
  let images!: ReturnType<typeof useWebChatImages>;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Harness({ scope }: { scope: string }) { images = useWebChatImages(scope, webChatCopy("en")); return null; }
  for (let i = 0; i < 10; i++) {
    await act(async () => { root.render(<Harness scope={"scope-" + i} />); });
    await act(async () => { images.add([new File(["x"], "image.png", { type: "image/png" })]); });
  }
  await act(async () => { images.retainScopes(new Set(["scope-0"])); });
  expect(revoked).toEqual(["blob:owned-1"]);
  await act(async () => { images.moveScope("scope-0", "stored-tip"); root.render(<Harness scope="stored-tip" />); });
  expect(images.images[0].previewUrl).toBe("blob:owned-0");
  await act(async () => { root.unmount(); }); host.remove();
  expect(new Set(revoked).size).toBe(10);
});
