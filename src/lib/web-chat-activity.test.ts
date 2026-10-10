import { describe, expect, it } from "vitest";
import { groupChatTranscript, toolCallTitle, toolResultFailed } from "./web-chat-activity";
import { transcriptMessages, type ChatMessage } from "./web-chat-state";

describe("web chat activity projection", () => {
  it("groups reasoning and tool steps without crossing user turns or dropping call arguments", () => {
    const command = { command: "git status --short" };
    const rows = transcriptMessages([
      { role: "user", text: "Inspect the project" },
      { role: "assistant", text: "", reasoning: "Check the working tree" },
      { role: "tool", name: "terminal", context: "git status --short", args: command },
      { role: "assistant", text: "", reasoning: "Read the documentation" },
      { role: "tool", name: "read_file", context: "README.md L1-150", args: { path: "README.md" } },
      { role: "assistant", text: "Project summary" },
      { role: "user", text: "Now search" },
      { role: "tool", name: "search_files", context: "*.ts", args: { pattern: "*.ts" } },
      { role: "assistant", text: "Search summary" },
    ]);
    const blocks = groupChatTranscript(rows);
    expect(blocks.filter((block) => block.kind === "message").map((block) => block.message.text))
      .toEqual(["Inspect the project", "Project summary", "Now search", "Search summary"]);
    const activity = blocks.filter((block) => block.kind === "activity");
    expect(activity.flatMap((block) => block.rows.filter((row) => row.role === "tool")))
      .toEqual(rows.filter((row) => row.role === "tool"));
    const firstTool = activity[0].rows.find((row) => row.role === "tool")!;
    expect(firstTool.toolArgs).toEqual(command);
    // A preview is not an output: current resume snapshots omit tool results.
    expect(firstTool.toolContext).toBe(command.command);
    expect(firstTool.text).toBe("");
    expect(activity[0].rows.some((row) => row.reasoning)).toBe(true);
    expect(activity[1].rows.every((row) => row.name !== "terminal")).toBe(true);
  });

  it("renders useful call previews and keeps execution failures separate from successful completion", () => {
    const tool: ChatMessage = { id: "tool:1", role: "tool", name: "terminal", text: "", toolArgs: { command: "npm test" } };
    expect(toolCallTitle(tool)).toContain(JSON.stringify(tool.toolArgs!.command));
    expect(toolCallTitle({ ...tool, name: "read_file", toolArgs: { path: "README.md" }, toolContext: "README.md L1-150" }))
      .toContain("README.md L1-150");
    expect(toolResultFailed({ exit_code: 0 })).toBe(false);
    expect(toolResultFailed({ exit_code: 1 })).toBe(true);
    expect(toolResultFailed({ error: "Permission denied" })).toBe(true);
    expect(toolResultFailed({ success: false })).toBe(true);
    const failed: ChatMessage = { id: "assistant:error", role: "assistant", text: "", status: "error" };
    expect(groupChatTranscript([tool, failed]).at(-1)).toMatchObject({ kind: "message", message: failed });
  });
});
