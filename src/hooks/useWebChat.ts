import { useContext, useSyncExternalStore } from "react";
import { WebChatWorkspaceContext } from "@/contexts/web-chat-workspace-context";

export function useWebChat() {
  const owner = useContext(WebChatWorkspaceContext);
  if (!owner) throw new Error("Web Chat requires a workspace provider");
  const { workspace, drafts } = owner;
  const summary = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const controller = summary.controller;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { state, controller, workspace, summary, drafts };
}
