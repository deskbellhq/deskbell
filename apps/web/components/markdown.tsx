import { type Block, type Inline, parseMarkdown } from "@deskbell/shared/markdown";
import type { ReactNode } from "react";

/**
 * Renders an answer's Markdown in the dashboard from the same tree the widget
 * draws (spec: answer-markdown, conversations-inbox-polish). No `innerHTML`:
 * every string the model wrote becomes a text node. Links open in a new tab
 * without the opener. Classes are the thread bubble's, so the block keeps the
 * bubble's size and rhythm rather than a document's. Keys are positions: the
 * tree is rebuilt from the string on every render and never reordered, so
 * the index is the identity (biome's index-key rule is off for this file).
 */
export function Markdown({ source }: { source: string }) {
  return <>{parseMarkdown(source).map((block, i) => renderBlock(block, i))}</>;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.t) {
    case "p":
      return (
        <p key={key} className="[&:not(:first-child)]:mt-2">
          {renderInline(block.c)}
        </p>
      );
    case "h": {
      const Tag = block.level <= 2 ? "h3" : "h4";
      return (
        <Tag key={key} className="font-semibold [&:not(:first-child)]:mt-3">
          {renderInline(block.c)}
        </Tag>
      );
    }
    case "ul":
      return (
        <ul key={key} className="list-disc pl-5 [&:not(:first-child)]:mt-2">
          {block.items.map((item, j) => (
            <li key={j} className="[&:not(:first-child)]:mt-1">
              {renderInline(item.c)}
              {item.sub?.map((sub, k) => renderBlock(sub, k))}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol
          key={key}
          className="list-decimal pl-5 [&:not(:first-child)]:mt-2"
          start={block.start === 1 ? undefined : block.start}
        >
          {block.items.map((item, j) => (
            <li key={j} className="[&:not(:first-child)]:mt-1">
              {renderInline(item.c)}
              {item.sub?.map((sub, k) => renderBlock(sub, k))}
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs [&:not(:first-child)]:mt-2"
          data-lang={block.lang || undefined}
        >
          <code>{block.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-2 pl-3 text-muted-foreground [&:not(:first-child)]:mt-2"
        >
          {block.c.map((b, j) => renderBlock(b, j))}
        </blockquote>
      );
    case "hr":
      return <hr key={key} className="my-3" />;
  }
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return node.v;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {node.v}
          </code>
        );
      case "strong":
        return <strong key={i}>{renderInline(node.c)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.c)}</em>;
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-4"
          >
            {renderInline(node.c)}
          </a>
        );
      default:
        return null;
    }
  });
}
