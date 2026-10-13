import type { Element } from "hast";
import type { Emphasis, Root } from "mdast";
import type { Plugin } from "unified";

interface PresentationNode {
  type: string;
  value?: string;
  children?: PresentationNode[];
  data?: Root["data"];
}

export interface MarkdownPresentationOptions {
  highlightTerms?: string[];
  streaming?: boolean;
}

const caret = (): Emphasis => ({
  type: "emphasis", children: [],
  data: { hName: "span", hProperties: { className: ["markdown-streaming-caret"], "aria-hidden": "true" } },
});

function appendCaret(node: PresentationNode): boolean {
  if (node.type === "code") {
    node.data = { ...node.data, hProperties: { "data-streaming": true } };
    return true;
  }
  if (["paragraph", "heading", "tableCell"].includes(node.type)) {
    node.children?.push(caret());
    return true;
  }
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) if (appendCaret(children[i])) return true;
  return false;
}

/** Presentation transforms on the standard Markdown AST; raw HTML remains escaped. */
export const remarkPresentation: Plugin<[MarkdownPresentationOptions?], Root> = (options = {}) => {
  const terms = options.highlightTerms?.filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = terms?.length ? new RegExp("(" + terms.join("|") + ")", "gi") : null;
  const walk = (node: PresentationNode) => {
    if (!node.children || node.type === "code" || node.type === "inlineCode") return;
    node.children = node.children.flatMap((child): PresentationNode[] => {
      if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value?.trim() || "")) return [{ type: "break" }];
      if (child.type === "text" && child.value && pattern) {
        return child.value.split(pattern).flatMap((value, i): PresentationNode[] => !value ? [] : [i % 2 ? {
          type: "emphasis", children: [{ type: "text", value }],
          data: { hName: "mark", hProperties: { className: ["bg-warning/30", "text-warning", "px-0.5"] } },
        } : { type: "text", value }]);
      }
      walk(child);
      return [child];
    });
  };
  return (tree) => {
    walk(tree);
    if (options.streaming && !appendCaret(tree)) tree.children.push({ type: "paragraph", children: [caret()] });
  };
};

export function safeMarkdownUrl(url: string, key: string): string {
  const value = url.trim();
  return (key === "href" ? /^(https?:|mailto:|#)/i : /^https?:/i).test(value) ? value : "";
}

export function markdownCodeBlock(node?: Element): { language: string; text: string; streaming: boolean } {
  const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  const classes = code?.properties.className;
  const languageClass = (Array.isArray(classes) ? classes : String(classes || "").split(" ")).find((name) => String(name).startsWith("language-"));
  return {
    language: String(languageClass || "").replace(/^language-/, ""),
    text: code?.children.map((child) => child.type === "text" ? child.value : "").join("").replace(/\n$/, "") || "",
    streaming: !!code?.properties["data-streaming"],
  };
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash", sh: "Shell", shell: "Shell", zsh: "Zsh", powershell: "PowerShell", ps1: "PowerShell",
  js: "JavaScript", javascript: "JavaScript", jsx: "JSX", ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  py: "Python", python: "Python", json: "JSON", yaml: "YAML", yml: "YAML", html: "HTML", css: "CSS",
  sql: "SQL", md: "Markdown", markdown: "Markdown", text: "Text", plaintext: "Text",
};

export function markdownLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language.toLowerCase()] || language;
}
