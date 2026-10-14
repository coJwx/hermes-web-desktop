import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useProfileScope } from "./useProfileScope";
import { WebChatWorkspaceContext, type WebChatWorkspaceOwner } from "./web-chat-workspace-context";
import { WebChatWorkspace } from "@/lib/web-chat-workspace";
import { WebChatDrafts } from "@/lib/web-chat-drafts";
import { webChatPersistence } from "@/lib/web-chat-persistence";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { CHAT_LIMITS } from "@/lib/web-chat-cache";

/** Mounted above Routes: view departure preserves resources; profile replacement disposes them. */
export function WebChatWorkspaceProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const { profile, currentProfile } = useProfileScope();
  const [visited, setVisited] = useState(false);
  const initialized = active || visited;
  const scope = profile || currentProfile;
  const owner = useMemo<WebChatWorkspaceOwner | null>(() => initialized ? {
    workspace: new WebChatWorkspace(webChatPersistence(scope)), drafts: new WebChatDrafts(),
  } : null, [initialized, scope]);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  useLayoutEffect(() => { owner?.workspace.setViewActive(active); }, [owner, active]);
  useEffect(() => {
    if (!owner) return;
    void owner.workspace.start();
    return () => { owner.workspace.stop(); owner.drafts.dispose(); };
  }, [owner]);
  return <WebChatWorkspaceContext.Provider key={scope} value={owner}>
    {owner && <WorkspaceGuard owner={owner} profile={scope} managementProfile={profile} />}
    {children}
  </WebChatWorkspaceContext.Provider>;
}

function WorkspaceGuard({ owner: { workspace, drafts }, profile, managementProfile }: { owner: WebChatWorkspaceOwner; profile: string; managementProfile: string }) {
  const summary = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  useSyncExternalStore(drafts.subscribe, drafts.getRevision);
  useUnsavedChanges(drafts.dirty || summary.dirty, summary.busy, true, managementProfile);
  const scopes = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    for (const tab of [...summary.tabs, ...summary.background]) {
      const id = tab.storedSessionId || tab.id;
      const prior = scopes.current.get(tab.id);
      if (prior && prior !== id) {
        const text = drafts.text.get(prior);
        if (text) { drafts.text.set(id, text); drafts.text.delete(prior); }
        const view = drafts.views.get(prior);
        if (view) { drafts.views.set(id, view); drafts.views.delete(prior); }
        drafts.moveScope(profile + ":" + prior, profile + ":" + id);
      }
      scopes.current.set(tab.id, id);
    }
    const protectedIds = new Set([...summary.tabs, ...summary.background].map(tab => tab.storedSessionId || tab.id));
    const closed = [...new Set([...drafts.views.keys(), ...drafts.text.keys()])].filter(id => !protectedIds.has(id));
    for (const id of closed.slice(0, Math.max(0, closed.length - CHAT_LIMITS.closedDrafts))) {
      drafts.text.delete(id); drafts.views.delete(id);
    }
    drafts.retainScopes(new Set([...protectedIds].map(id => profile + ":" + id)));
    for (const tabId of scopes.current.keys()) if (!workspace.getBinding(tabId)) scopes.current.delete(tabId);
    drafts.notify();
  }, [workspace, summary.tabs, summary.background, drafts, profile]);
  return null;
}
