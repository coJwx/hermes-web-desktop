import { looksLikeSlashCommand } from "@hermes/shared";

export interface SlashCompletionEdit { value: string; cursor: number }

export function slashCompletionQuery(value: string, cursor: number): string | null {
  const prefix = value.slice(0, cursor);
  return prefix.startsWith("/") && !prefix.includes("\n") && looksLikeSlashCommand(prefix) ? prefix : null;
}

export function applySlashCompletion(value: string, cursor: number, replaceFrom: number, text: string): SlashCompletionEdit {
  let from = Math.max(0, Math.min(replaceFrom, cursor));
  // Most command items omit '/', but gateway extras include it.
  if (from === 1 && value[0] === "/" && text.startsWith("/")) from = 0;
  const tokenEnd = cursor + (value.slice(cursor).match(/^\S*/)?.[0].length ?? 0);
  const inserted = from <= 1 && !/\s/.test(text) ? text + " " : text;
  return { value: value.slice(0, from) + inserted + value.slice(tokenEnd), cursor: from + inserted.length };
}
