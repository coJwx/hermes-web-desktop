import { createContext } from "react";
import type { WebChatWorkspace } from "@/lib/web-chat-workspace";
import type { WebChatDrafts } from "@/lib/web-chat-drafts";
import type { WebChatMediaCache } from "@/lib/web-chat-media";

export interface WebChatWorkspaceOwner { workspace: WebChatWorkspace; drafts: WebChatDrafts; media: WebChatMediaCache; }
export const WebChatWorkspaceContext = createContext<WebChatWorkspaceOwner | null>(null);
