import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The models answer in Markdown, so it is rendered as Markdown rather than
 * shown as its own source. Every element is styled explicitly here — there is
 * no typography plugin in the build, and the answer should read like the rest
 * of the workbench rather than like a web page dropped into it.
 *
 * Raw HTML in the answer is not rendered: react-markdown ignores it unless a
 * rehype-raw plugin is added, and an answer from a model is not something to
 * hand the browser as markup.
 */
const COMPONENTS: Components = {
  // A real size step between levels: answers lean on ## for their top level,
  // and in a text-sm panel a semibold line the size of the body text does not
  // read as a heading at all. Each size is half again the body scale it started
  // from — 1.125/1/0.875rem grown by 50% — with tight leading so the larger
  // lines do not drift apart.
  h1: ({ children }) => (
    <h3 className="mt-6 text-[1.6875rem] font-semibold leading-tight tracking-tight first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="mt-5 text-[1.5rem] font-semibold leading-tight tracking-tight first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-4 text-[1.3125rem] font-semibold leading-tight tracking-tight first:mt-0">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="mt-4 font-mono text-[1.125rem] uppercase leading-tight tracking-[0.15em] text-muted-foreground first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="mt-3 first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5 first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5 first:mt-0">{children}</ol>,
  li: ({ children }) => <li className="[&>p]:mt-0">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-muted-foreground first:mt-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-border" />,
  // Fenced blocks arrive as <pre><code>; the wrapper scrolls sideways so a long
  // line cannot stretch the column.
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed first:mt-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const fenced = typeof className === "string" && className.includes("language-");
    if (fenced) return <code className={className}>{children}</code>;
    return (
      <code className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto first:mt-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
