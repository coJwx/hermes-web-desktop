import { describe, expect, it } from "vitest";
import { JsonRpcGatewayError } from "@hermes/shared";
import { runWebChatCommand, type WebChatCommandHost } from "./web-chat-commands";
import { applySlashCompletion, slashCompletionQuery } from "./web-chat-completion";
import { webChatCopy } from "./web-chat-copy";

const copy = webChatCopy("en");

describe("web chat slash command contracts", () => {
  it("completes command/argument tokens and keeps deferred commands and worker failures out of model submission", async () => {
    expect(slashCompletionQuery("/m", 2)).toBe("/m");
    expect(slashCompletionQuery("/usr/local", 10)).toBeNull();
    expect(slashCompletionQuery("Explain /model", 14)).toBeNull();
    expect(applySlashCompletion("/m", 2, 1, "model").value).toBe("/model ");
    expect(applySlashCompletion("/den", 4, 1, "/density").value).toBe("/density ");
    expect(applySlashCompletion("/model op", 9, 7, "openai").value).toBe("/model openai");
    const calls: string[] = [];
    const sent: string[] = [];
    const outputs: string[] = [];
    let failWorker = false;
    const host: WebChatCommandHost = {
      request: async <T>(method: string): Promise<T> => {
        calls.push(method);
        if (method === "commands.catalog") return { canon: {} } as T;
        if (method === "slash.exec" && failWorker) throw new JsonRpcGatewayError("Worker timed out", { code: 5030 });
        return { output: "\u001b[32mCurrent model: test-model\u001b[0m" } as T;
      },
      submit: async (text) => { sent.push(text); return true; },
      output: (_command, text) => { outputs.push(text); },
      refreshHistory: async () => {},
    };
    for (const command of ["/new", "/reset", "/stop", "/resume previous"]) {
      await expect(runWebChatCommand(host, command, copy)).rejects.toThrow("not connected yet");
    }
    expect(calls).toEqual([]);
    await runWebChatCommand(host, "/model", copy);
    expect(outputs).toEqual(["Current model: test-model"]);
    expect(sent).toEqual([]);
    failWorker = true;
    await expect(runWebChatCommand(host, "/memory", copy)).rejects.toThrow("Worker timed out");
    expect(calls).not.toContain("command.dispatch");
  });

  it("falls through only on ownership refusal, hides expanded skill text, and returns prefill without running a model", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const submissions: Array<{ text: string; display: string }> = [];
    const expanded = "Private expanded skill instructions";
    let prefill = false;
    let refreshed = 0;
    const host: WebChatCommandHost = {
      request: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
        calls.push({ method, params });
        if (method === "commands.catalog") return { canon: {} } as T;
        if (method === "slash.exec") throw new JsonRpcGatewayError("Skill dispatch owns this command", { code: 4018 });
        return (prefill ? { type: "prefill", message: "Edit this draft" } : { type: "skill", name: "review", message: expanded, display: "/review changes" }) as T;
      },
      submit: async (text, display) => { submissions.push({ text, display }); return true; },
      output: () => {},
      refreshHistory: async () => { refreshed++; },
    };
    const argument = "first line\n  indented line";
    await runWebChatCommand(host, "/review " + argument, copy);
    expect(calls.find((call) => call.method === "command.dispatch")?.params).toEqual({ name: "review", arg: argument });
    expect(submissions).toEqual([{ text: expanded, display: "/review changes" }]);
    prefill = true;
    expect(await runWebChatCommand(host, "/undo", copy)).toEqual({ accepted: true, prefill: "Edit this draft" });
    expect(submissions).toHaveLength(1);
    expect(refreshed).toBe(1);
  });
});
