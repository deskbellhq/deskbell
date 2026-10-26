import { type Block, type Inline, parseMarkdown } from "@deskbell/shared/markdown";
import type { ComponentChildren } from "preact";

interface MarkdownProps {
  source: string;
  /** Called with the href of any link the visitor follows. */
  onLink?: (href: string) => void;
}

/**
 * Renders an answer's Markdown as vnodes (spec: answer-markdown). No
 * `innerHTML` anywhere: every string the model wrote becomes a text node, so
 * there is nothing to sanitise. Links open in a new tab and never carry the
 * opener. Structural elements expose `md-*` parts for the host page's CSS.
 */
export function Markdown({ source, onLink }: MarkdownProps) {
  return <>{parseMarkdown(source).map((block, i) => renderBlock(block, i, onLink))}</>;
}

function renderBlock(
  block: Block,
  key: number,
  onLink?: (href: string) => void,
): ComponentChildren {
  switch (block.t) {
    case "p":
      return <p key={key}>{renderInline(block.c, onLink)}</p>;
    case "h": {
      // Answers sit in a bubble under the panel's own heading; two sizes are
      // enough to keep the structure without shouting.
      const Tag = block.level <= 2 ? "h3" : "h4";
      return (
        <Tag key={key} part="md-heading">
          {renderInline(block.c, onLink)}
        </Tag>
      );
    }
    case "ul":
      return (
        <ul key={key} part="md-list">
          {block.items.map((item, j) => (
            <li key={j}>
              {renderInline(item.c, onLink)}
              {item.sub?.map((sub, k) => renderBlock(sub, k, onLink))}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} part="md-list" start={block.start === 1 ? undefined : block.start}>
          {block.items.map((item, j) => (
            <li key={j}>
              {renderInline(item.c, onLink)}
              {item.sub?.map((sub, k) => renderBlock(sub, k, onLink))}
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre key={key} part="md-code" data-lang={block.lang || undefined}>
          <code>{block.v}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={key}>{block.c.map((b, j) => renderBlock(b, j, onLink))}</blockquote>;
    case "hr":
      return <hr key={key} />;
    case "table":
      return (
        <div key={key} part="md-table" class="md-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, j) => (
                  <th key={j} style={block.align[j] ? { textAlign: block.align[j] } : undefined}>
                    {renderInline(cell, onLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, j) => (
                    <td key={j} style={block.align[j] ? { textAlign: block.align[j] } : undefined}>
                      {renderInline(cell, onLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function renderInline(nodes: Inline[], onLink?: (href: string) => void): ComponentChildren {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return node.v;
      case "br":
        return <br key={i} />;
      case "code":
        return <code key={i}>{node.v}</code>;
      case "strong":
        return <strong key={i}>{renderInline(node.c, onLink)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.c, onLink)}</em>;
      case "link":
        return (
          <a
            key={i}
            part="md-link"
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={onLink ? () => onLink(node.href) : undefined}
          >
            {renderInline(node.c, onLink)}
          </a>
        );
      default:
        return null;
    }
  });
}
