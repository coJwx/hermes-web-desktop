import type { SessionImportResponse } from "@/lib/api";

export type ImportableSession = Record<string, unknown>;

function normalizeImportSessions(value: unknown): ImportableSession[] {
  const candidate =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { sessions?: unknown }).sessions)
      ? (value as { sessions: unknown[] }).sessions
      : Array.isArray(value)
        ? value
        : [value];

  const sessions = candidate.filter(
    (item): item is ImportableSession =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
  if (sessions.length !== candidate.length) {
    throw new Error("Expected exported session JSON or JSONL");
  }
  return sessions;
}

export function parseImportSessions(text: string): ImportableSession[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("File is empty");

  try {
    return normalizeImportSessions(JSON.parse(trimmed));
  } catch (jsonError) {
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length <= 1) throw jsonError;
    return normalizeImportSessions(lines.map((line) => JSON.parse(line)));
  }
}

export interface ImportSummaryMessages {
  imported: string;
  skipped: string;
  detached: string;
}

const ENGLISH_IMPORT_SUMMARY: ImportSummaryMessages = {
  imported: "{count} imported",
  skipped: "{count} skipped",
  detached: "{count} detached from missing parents",
};

export function importSummary(
  result: SessionImportResponse,
  messages: ImportSummaryMessages = ENGLISH_IMPORT_SUMMARY,
): string {
  const parts = [messages.imported.replace("{count}", String(result.imported))];
  if (result.skipped > 0) {
    parts.push(messages.skipped.replace("{count}", String(result.skipped)));
  }
  if (result.detached > 0) {
    parts.push(messages.detached.replace("{count}", String(result.detached)));
  }
  return parts.join("; ");
}
