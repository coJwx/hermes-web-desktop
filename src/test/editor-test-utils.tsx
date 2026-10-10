import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Link, Route, RouterProvider, Routes } from "react-router";
import { vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { UnsavedChangesProvider } from "@/contexts/UnsavedChangesProvider";
import { ProfileProvider } from "@/contexts/ProfileProvider";
import { PageHeaderProvider } from "@/contexts/PageHeaderProvider";
import { useProfileScope } from "@/contexts/useProfileScope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TestShell({ children }: { children: ReactNode }) {
  const { profile, setProfile } = useProfileScope();
  const [hostEdits, setHostEdits] = useState(0);
  return <>
    <button onClick={() => setHostEdits((value) => value + 1)}>Host {hostEdits}</button>
    <Link to="/other">Leave editor</Link>
    <button onClick={() => setProfile(profile === "A" ? "B" : "A")}>Switch profile</button>
    <output data-profile>{profile}</output>
    <PageHeaderProvider pluginTabs={[]}>
      <div key={profile}>
        <Routes>
          <Route path="/edit" element={children} />
          <Route path="/other" element={<p>Other page</p>} />
        </Routes>
      </div>
    </PageHeaderProvider>
  </>;
}

export async function mountEditor(children: ReactNode, initialEntries = ["/other", "/edit?profile=A"]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const router = createMemoryRouter([{ path: "*", element:
    <I18nProvider><UnsavedChangesProvider><ProfileProvider>
      <TestShell>{children}</TestShell>
    </ProfileProvider></UnsavedChangesProvider></I18nProvider>,
  }], { initialEntries, initialIndex: initialEntries.length - 1 });
  await act(async () => { root.render(<RouterProvider router={router} />); });
  return {
    router,
    async unmount() {
      await act(async () => { root.unmount(); });
      router.dispose();
      container.remove();
    },
  };
}

export function setupEditorDOM() {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

export async function press(label: string, scope: ParentNode = document) {
  const element = [...scope.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a")]
    .find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (!element) throw new Error("Missing control: " + label);
  await act(async () => { element.click(); });
}

export async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function profileResponse(path: string) {
  if (path === "/api/profiles") return json({ profiles: [{ name: "A" }, { name: "B" }] });
  if (path === "/api/profiles/active") return json({ current: "default", active: "default" });
}
