import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import type { Element, Root } from "hast";
import { markdownCodeBlock, markdownLanguageLabel, remarkPresentation, safeMarkdownUrl, type MarkdownPresentationOptions } from "./markdown-presentation";

function parse(text: string, options: MarkdownPresentationOptions = {}): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkPresentation, options)
    .use(remarkRehype, { allowDangerousHtml: true });
  return processor.runSync(processor.parse(text)) as Root;
}

function elements(node: Root | Element, tagName: string): Element[] {
  return node.children.flatMap((child): Element[] => child.type === "element" ?
    [...(child.tagName === tagName ? [child] : []), ...elements(child, tagName)] : []);
}

describe("Standard Markdown presentation", () => {
  it("keeps fence language and command separate across indentation, nesting, CRLF and unfinished streams", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const cases = [
      fence + "bash\nhermes update\n" + fence,
      "Before\n  " + fence + "bash\n  hermes update\n  " + fence + "\nAfter",
      "- Update:\n\n  " + fence + "bash\n  hermes update\n  " + fence,
      "> " + fence + "bash\n> hermes update\n> " + fence,
      fence + "bash\r\nhermes update\r\n" + fence,
      "~~~bash\nhermes update\n~~~",
      fence + "bash\nhermes update",
    ];
    for (const content of cases) {
      const blocks = elements(parse(content, { streaming: true }), "pre");
      expect(blocks).toHaveLength(1);
      expect(markdownCodeBlock(blocks[0])).toEqual({ language: "bash", text: "hermes update", streaming: !content.endsWith("After") });
    }
    const longFence = fence + String.fromCharCode(96);
    const block = elements(parse(longFence + "bash\n" + fence + "\n" + longFence), "pre")[0];
    expect(markdownCodeBlock(block).text).toBe(fence);
    expect(markdownLanguageLabel(markdownCodeBlock(block).language)).toBe("Bash");
    const inline = parse("Run " + String.fromCharCode(96) + "hermes update" + String.fromCharCode(96));
    expect(elements(inline, "pre")).toEqual([]);
    expect(elements(inline, "code")).toHaveLength(1);
  });

  it("preserves GFM tables, nested formatting, search highlighting, safe breaks and URL restrictions", () => {
    const fence = String.fromCharCode(96);
    const content = "| Module | Status | Notes |\n| :--- | :---: | ---: |\n" +
      "| **Core** | 100% | first<br>second \\| third |\n\n" +
      "- **Run " + fence + "hermes update" + fence + "**\n  - term a+b\n\n" +
      "term " + fence.repeat(3) + "\n<script>alert(1)</script>";
    const tree = parse(content, { highlightTerms: ["term", "a+b"], streaming: true });
    expect(elements(tree, "table")).toHaveLength(1);
    expect(elements(tree, "th").map((node) => node.properties.align)).toEqual(["left", "center", "right"]);
    expect(elements(tree, "br")).toHaveLength(1);
    expect(elements(tree, "ul")).toHaveLength(2);
    expect(elements(elements(tree, "strong").at(-1)!, "code")[0].children).toMatchObject([{ type: "text", value: "hermes update" }]);
    expect(elements(tree, "mark")).toHaveLength(3);
    expect(elements(tree, "script")).toEqual([]);
    expect(elements(tree, "span").some((node) => Array.isArray(node.properties.className) && node.properties.className.includes("markdown-streaming-caret"))).toBe(true);
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///secret"]) expect(safeMarkdownUrl(url, "href")).toBe("");
    expect(safeMarkdownUrl("https://example.com", "href")).toBe("https://example.com");
    expect(safeMarkdownUrl("#section", "href")).toBe("#section");
  });
});
