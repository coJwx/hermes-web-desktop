import { describe, expect, it } from "vitest";

import { formatSessionPruneResult } from "./session-prune";

describe("formatSessionPruneResult", () => {
  it("uses translated count templates when open sessions were skipped", () => {
    expect(
      formatSessionPruneResult(
        { removed: 2, skipped_open: 1 },
        {
          pruned: "已清理 {count} 个会话。",
          skippedOpen: "已跳过 {count} 个仍在进行的会话。",
        },
      ),
    ).toBe("已清理 2 个会话。 已跳过 1 个仍在进行的会话。");
  });
});
