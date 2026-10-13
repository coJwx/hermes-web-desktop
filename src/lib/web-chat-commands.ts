import { JsonRpcGatewayError, parseCommandDispatch, parseSlashCommand, stripAnsi, type CommandsCatalogResult, type SlashExecResult } from "@hermes/shared";
import type { WebChatCopy } from "./web-chat-copy";

const DEFERRED_COMMANDS = new Set(["new", "reset", "stop", "resume", "session", "sessions", "switch"]);
const HISTORY_COMMANDS = new Set(["undo", "compress", "compact"]);

export interface WebChatCommandResult { accepted: boolean; prefill?: string }
export interface WebChatCommandHost {
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  submit(text: string, display: string): Promise<boolean>;
  output(command: string, text: string): void;
  refreshHistory(): Promise<void>;
}

/** Execute the shared wire directives; expanded skill bodies never become display text. */
export async function runWebChatCommand(host: WebChatCommandHost, command: string, copy: WebChatCopy, depth = 0): Promise<WebChatCommandResult> {
  if (depth >= 8) throw new Error(copy.commandAliasLoop);
  const parsed = parseSlashCommand(command.trim());
  if (!parsed.name) throw new Error(copy.commandPickFirst);
  if (DEFERRED_COMMANDS.has(parsed.name)) throw new Error(copy.commandDeferred.replace("{command}", "/" + parsed.name));

  let canonical = parsed.name;
  try {
    const catalog = await host.request<CommandsCatalogResult>("commands.catalog");
    canonical = (catalog.canon?.["/" + parsed.name] ?? parsed.name).replace(/^\//, "");
  } catch (error) {
    // Older backends may lack the optional catalog; execution failures remain visible.
    if (!(error instanceof JsonRpcGatewayError) || error.code !== -32601) throw error;
  }
  if (DEFERRED_COMMANDS.has(canonical)) throw new Error(copy.commandDeferred.replace("{command}", "/" + canonical));

  let raw: SlashExecResult;
  try {
    raw = await host.request<SlashExecResult>("slash.exec", { command: command.trim().slice(1) });
  } catch (error) {
    // Only ownership refusals fall through; a timeout/crash must never re-execute a command.
    if (!(error instanceof JsonRpcGatewayError) || ![4011, 4018].includes(error.code ?? 0)) throw error;
    raw = await host.request<SlashExecResult>("command.dispatch", { name: parsed.name, arg: parsed.arg });
  }

  const output = (text: string) => host.output(command, stripAnsi(text));
  if (raw.warning) output(raw.warning);
  const directive = parseCommandDispatch(raw);
  if (raw.type && !directive) throw new Error(copy.commandInvalidResult);
  if (!directive) {
    if (HISTORY_COMMANDS.has(canonical)) await host.refreshHistory();
    output(raw.output || copy.commandNoOutput);
    return { accepted: true };
  }

  switch (directive.type) {
    case "exec":
    case "plugin":
      if (HISTORY_COMMANDS.has(canonical)) await host.refreshHistory();
      output(directive.output || copy.commandNoOutput);
      return { accepted: true };
    case "alias": {
      const target = "/" + directive.target.replace(/^\/+/, "") + (parsed.arg ? " " + parsed.arg : "");
      return runWebChatCommand(host, target, copy, depth + 1);
    }
    case "skill":
    case "send":
      if (!directive.message?.trim()) throw new Error(copy.commandInvalidResult);
      if (directive.type === "send" && directive.notice) output(directive.notice);
      return { accepted: await host.submit(directive.message, directive.display?.trim() || command) };
    case "prefill":
      await host.refreshHistory();
      if (directive.notice) output(directive.notice);
      return { accepted: true, prefill: directive.message };
  }
}
