import type { ManagedFileReadResponse } from "./api";

export const MAX_FILE_PREVIEW_BYTES = 5 * 1024 * 1024;

export type FilePreviewContent =
  | { kind: "image"; source: string }
  | { kind: "text"; text: string }
  | { kind: "unsupported" }
  | { kind: "tooLarge" };

export function filePreviewContent(file: ManagedFileReadResponse): FilePreviewContent {
  if (file.size > MAX_FILE_PREVIEW_BYTES) return { kind: "tooLarge" };
  if (file.mime_type.startsWith("image/")) return { kind: "image", source: file.data_url };

  const encoded = file.data_url.slice(file.data_url.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return { kind: "unsupported" };
  }
  // Decode before checking controls so BOM-marked UTF-16 is not mistaken for binary.
  if (Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 && ![9, 10, 12, 13].includes(code)) || code === 127;
  })) return { kind: "unsupported" };
  return { kind: "text", text };
}
