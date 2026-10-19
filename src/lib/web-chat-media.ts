import { fetchJSON } from "./api";
import { CHAT_LIMITS } from "./web-chat-cache";

interface MediaRead { abort: AbortController; readers: number; promise: Promise<string> }
interface CachedMedia { source: string; bytes: number }
export interface ChatMediaLease { promise: Promise<string>; release: () => void }

/** One workspace owns a bounded cache of encoded media, not decoded image pixels. */
export class WebChatMediaCache {
  private entries = new Map<string, CachedMedia>();
  private pending = new Map<string, MediaRead>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  constructor(maxBytes: number = CHAT_LIMITS.mediaBytes, maxEntries: number = CHAT_LIMITS.mediaEntries) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries;
  }
  private key(profile: string, path: string) { return profile + "\0" + path; }

  get(profile: string, path: string): string | undefined {
    const key = this.key(profile, path);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.source;
  }

  acquire(profile: string, path: string): ChatMediaLease {
    const cached = this.get(profile, path);
    if (cached !== undefined) return { promise: Promise.resolve(cached), release: () => {} };
    const key = this.key(profile, path);
    let read = this.pending.get(key);
    if (!read) {
      const abort = new AbortController();
      const query = new URLSearchParams({ profile, path });
      const promise = fetchJSON<{ data_url: string }>("/api/media?" + query, { signal: abort.signal }).then(result => {
        if (typeof result.data_url !== "string") throw new Error("Image data is unavailable.");
        if (!abort.signal.aborted && this.pending.get(key)?.abort === abort) this.retain(key, result.data_url);
        return result.data_url;
      }).finally(() => { if (this.pending.get(key)?.abort === abort) this.pending.delete(key); });
      read = { abort, readers: 0, promise };
      this.pending.set(key, read);
    }
    const activeRead = read;
    activeRead.readers++;
    let released = false;
    return { promise: activeRead.promise, release: () => {
      if (released) return;
      released = true;
      if (--activeRead.readers === 0 && this.pending.get(key) === activeRead) {
        this.pending.delete(key); activeRead.abort.abort();
      }
    } };
  }

  private retain(key: string, source: string) {
    const bytes = source.length * 2;
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(key, { source, bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
  }

  clear = () => {
    for (const read of this.pending.values()) read.abort.abort();
    this.pending.clear(); this.entries.clear(); this.bytes = 0;
  };
}
