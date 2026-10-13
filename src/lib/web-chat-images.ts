import { errorMessage } from "./api-error";
import type { ChatImageUploadResult } from "./chatImagePaste";

export const WEB_CHAT_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
const IMAGE_TYPES = new Set(WEB_CHAT_IMAGE_ACCEPT.split(","));
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface ChatImage {
  name: string;
  path?: string;
  dataUrl?: string;
}

export interface DraftChatImage {
  id: string;
  file: File;
  previewUrl: string;
}

export function imageValidationError(file: Pick<File, "name" | "size" | "type">): "imageEmpty" | "imageTooLarge" | "imageUnsupported" | null {
  if (!file.size) return "imageEmpty";
  if (file.size > MAX_IMAGE_BYTES) return "imageTooLarge";
  if (!IMAGE_TYPES.has(file.type) && !(file.type === "" && IMAGE_EXTENSION.test(file.name))) return "imageUnsupported";
  return null;
}

export function imageName(path: string): string {
  return path.split(/[\\/]/).at(-1) || "Image";
}

/** The gateway persists path refs and, for native vision, an additional data URL. */
export function imageMessageContent(text: string): { text: string; images: ChatImage[] } {
  const paths: ChatImage[] = [];
  const embedded: ChatImage[] = [];
  const lines = text.split("\n");
  const kept: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*(?:\x60{3,}|~{3,})/.test(line)) inCode = !inCode;
    const ref = !inCode && line.match(/^@image:(.+)\r?$/);
    if (ref) {
      let path = ref[1].trim();
      if (/^[\x60"']/.test(path) && path.at(-1) === path[0]) path = path.slice(1, -1);
      if (path) paths.push({ path, name: imageName(path) });
      else kept.push(line);
    } else if (!inCode && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+\r?$/.test(line)) {
      embedded.push({ dataUrl: line.trim(), name: "Image " + (embedded.length + 1) });
    } else {
      kept.push(line);
    }
  }
  const images = paths.length ? paths : embedded;
  return {
    text: images.length ? kept.filter((line) => line !== "[image]" && line !== "[screenshot]").join("\n").trim() : text,
    images: [...new Map(images.map((image) => [image.path || image.dataUrl, image])).values()],
  };
}

export async function detachChatImages(paths: string[], detach: (path: string) => Promise<unknown>): Promise<string[]> {
  const results = await Promise.allSettled(paths.map(detach));
  return paths.filter((_, i) => results[i].status === "rejected");
}

export class ImageStagingError extends Error {
  readonly pendingPaths: string[];
  constructor(cause: unknown, pendingPaths: string[]) {
    super(errorMessage(cause), { cause });
    this.pendingPaths = pendingPaths;
  }
}

interface ImageStagingHost {
  upload: (file: File) => Promise<ChatImageUploadResult>;
  attach: (path: string) => Promise<{ attached: boolean }>;
  detach: (path: string) => Promise<unknown>;
}

/** Upload alone does not queue an image; known paths let us undo even a lost attach ACK. */
export async function stageChatImages(files: File[], host: ImageStagingHost): Promise<ChatImage[]> {
  const images: ChatImage[] = [];
  const queued: string[] = [];
  try {
    for (const file of files) {
      const uploaded = await host.upload(file);
      queued.push(uploaded.path);
      const result = await host.attach(uploaded.path);
      if (!result.attached) throw new Error("Hermes did not attach the image.");
      images.push({ path: uploaded.path, name: file.name || uploaded.name });
    }
    return images;
  } catch (error) {
    throw new ImageStagingError(error, await detachChatImages(queued, host.detach));
  }
}
