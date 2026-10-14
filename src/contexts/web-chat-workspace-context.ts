import { createContext } from "react";
import type { WebChatWorkspace } from "@/lib/web-chat-workspace";
import type { WebChatDrafts } from "@/lib/web-chat-drafts";

export interface WebChatWorkspaceOwner { workspace: WebChatWorkspace; drafts: WebChatDrafts; }
export const WebChatWorkspaceContext = createContext<WebChatWorkspaceOwner | null>(null);
