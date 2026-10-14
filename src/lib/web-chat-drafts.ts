import { imageValidationError, type DraftChatImage } from "./web-chat-images";
import type { WebChatCopy } from "./web-chat-copy";
import { CHAT_LIMITS } from "./web-chat-cache";

export interface ChatDraftView { scroll: number; follow: boolean; cursor: number; }
interface ImageDraftSnapshot { drafts: Record<string, DraftChatImage[]>; errors: Record<string, string | null>; }

/** Files and object URLs belong to the workspace, rather than a mounted composer. */
export class WebChatDrafts {
  readonly text = new Map<string, string>();
  readonly views = new Map<string, ChatDraftView>();
  private snapshot: ImageDraftSnapshot = { drafts: {}, errors: {} };
  private listeners = new Set<() => void>();
  private urls = new Set<string>();
  private nextId = 0;
  private revision = 0;
  getSnapshot = () => this.snapshot;
  getRevision = () => this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  notify = () => { this.revision++; for (const listener of this.listeners) listener(); };
  get dirty() { return [...this.text.values()].some(text => !!text.trim()) || Object.values(this.snapshot.drafts).some(images => images.length > 0); }
  setError = (scope: string, error: string | null) => {
    const errors = { ...this.snapshot.errors };
    if (error) errors[scope] = error; else delete errors[scope];
    this.snapshot = { ...this.snapshot, errors }; this.notify();
  };
  add = (scope: string, files: File[], copy: WebChatCopy) => {
    const added: DraftChatImage[] = []; const invalid: string[] = [];
    let bytes = Object.values(this.snapshot.drafts).flat().reduce((sum, image) => sum + image.file.size, 0);
    for (const file of files) {
      if (bytes + file.size > CHAT_LIMITS.images) { invalid.push(copy.imageDraftLimit); continue; }
      const error = imageValidationError(file);
      if (error) { invalid.push(file.name + ": " + copy[error]); continue; }
      bytes += file.size;
      const previewUrl = URL.createObjectURL(file); this.urls.add(previewUrl);
      added.push({ id: "image:" + ++this.nextId, file, previewUrl });
    }
    if (added.length) this.snapshot = { ...this.snapshot, drafts: { ...this.snapshot.drafts, [scope]: [...(this.snapshot.drafts[scope] || []), ...added] } };
    this.setError(scope, invalid.length ? invalid.join("\n") : null);
  };
  remove = (scope: string, ids: string[]) => {
    const removed = new Set(ids);
    for (const image of this.snapshot.drafts[scope] || []) if (removed.has(image.id)) this.revoke(image);
    const remaining = (this.snapshot.drafts[scope] || []).filter(image => !removed.has(image.id));
    const drafts = { ...this.snapshot.drafts };
    if (remaining.length) drafts[scope] = remaining; else delete drafts[scope];
    this.snapshot = { ...this.snapshot, drafts }; this.notify();
  };
  moveScope = (from: string, to: string) => {
    if (from === to || !this.snapshot.drafts[from]) return;
    const drafts = { ...this.snapshot.drafts, [to]: [...(this.snapshot.drafts[to] || []), ...this.snapshot.drafts[from]] };
    const errors = { ...this.snapshot.errors };
    if (errors[from]) errors[to] = errors[from];
    delete errors[from]; delete drafts[from]; this.snapshot = { drafts, errors }; this.notify();
  };
  retainScopes = (protectedScopes: Set<string>) => {
    const closed = [...new Set([...Object.keys(this.snapshot.drafts), ...Object.keys(this.snapshot.errors)])].filter(key => !protectedScopes.has(key));
    if (closed.length <= CHAT_LIMITS.closedDrafts) return;
    const drafts = { ...this.snapshot.drafts }; const errors = { ...this.snapshot.errors };
    for (const key of closed.slice(0, closed.length - CHAT_LIMITS.closedDrafts)) {
      for (const image of drafts[key] || []) this.revoke(image);
      delete drafts[key]; delete errors[key];
    }
    this.snapshot = { drafts, errors }; this.notify();
  };
  private revoke(image: DraftChatImage) {
    if (this.urls.delete(image.previewUrl)) URL.revokeObjectURL(image.previewUrl);
  }
  dispose = () => {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear(); this.text.clear(); this.views.clear();
    this.snapshot = { drafts: {}, errors: {} }; this.notify();
  };
}
