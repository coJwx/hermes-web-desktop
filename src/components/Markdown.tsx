import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { markdownCodeBlock, remarkPresentation, safeMarkdownUrl } from "@/lib/markdown-presentation";

interface MarkdownProps {
  content: string;
  highlightTerms?: string[];
  streaming?: boolean;
}

const components: Components = {
  pre: ({ node }) => <MarkdownCodeBlock {...markdownCodeBlock(node)} />,
  code: ({ children, className }) => <code className={"rounded bg-secondary/60 px-1.5 py-0.5 text-xs font-mono text-primary/90 " + (className || "")}>{children}</code>,
  h1: ({ node: _node, ...props }) => <h1 {...props} className="text-base font-bold" />,
  h2: ({ node: _node, ...props }) => <h2 {...props} className="text-sm font-bold" />,
  h3: ({ node: _node, ...props }) => <h3 {...props} className="text-sm font-semibold" />,
  h4: ({ node: _node, ...props }) => <h4 {...props} className="text-sm font-medium" />,
  h5: ({ node: _node, ...props }) => <h5 {...props} className="text-sm font-medium" />,
  h6: ({ node: _node, ...props }) => <h6 {...props} className="text-sm font-medium" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  hr: () => <hr className="border-border" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="list-disc space-y-1 pl-5 [&_ul]:mt-1 [&_ol]:mt-1" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="list-decimal space-y-1 pl-5 [&_ul]:mt-1 [&_ol]:mt-1" />,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 border-border pl-4 text-text-secondary">{children}</blockquote>,
  a: ({ children, href, title, id }) => href ? <a href={href} title={title} id={id} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer"
    className="text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors">{children}</a> : <>{children}</>,
  img: ({ src, alt, title }) => src ? <img src={src} alt={alt || ""} title={title} loading="lazy" className="max-w-full rounded-lg" /> : <span>{alt}</span>,
  table: ({ children }) => <div className="max-w-full overflow-x-auto rounded-lg border border-border"><table className="min-w-full border-collapse text-sm">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-secondary/60">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children, style }) => <th scope="col" style={style} className="min-w-28 border-r border-border px-3 py-2 text-left font-semibold last:border-r-0">{children}</th>,
  td: ({ children, style }) => <td style={style} className="border-r border-border px-3 py-2 text-left align-top last:border-r-0">{children}</td>,
};

/** CommonMark + GFM parsing; React controls presentation and never executes raw HTML. */
export function Markdown({ content, highlightTerms, streaming }: MarkdownProps) {
  return <div className="markdown-content space-y-2 text-sm leading-relaxed text-foreground">
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkPresentation, { highlightTerms, streaming }]]}
      components={components} urlTransform={safeMarkdownUrl}>
      {content}
    </ReactMarkdown>
  </div>;
}
