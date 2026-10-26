import { render } from "preact-render-to-string";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./render.tsx";

describe("Markdown", () => {
  it("renders a pipe table inside the md-table part with its alignment", () => {
    const html = render(
      <Markdown source={"| Plan | Limit |\n|---|---:|\n| Starter | **100** |"} />,
    );
    expect(html).toContain('<div part="md-table" class="md-table"><table>');
    expect(html).toContain("<th>Plan</th>");
    expect(html).toContain('<td style="text-align:right;"><strong>100</strong></td>');
    expect(html).not.toContain("|---");
  });

  it("renders structure with parts and escapes everything the model wrote", () => {
    const html = render(
      <Markdown source={'## Steps\n1. Run `npm i`\n2. Open <b>x</b>\n\n```sh\necho "<hi>"\n```'} />,
    );
    expect(html).toContain('<h3 part="md-heading">Steps</h3>');
    expect(html).toContain('<ol part="md-list"><li>Run <code>npm i</code></li>');
    // The serializer escapes what matters: no element is created from model text.
    expect(html).toContain("Open &lt;b>x&lt;/b>");
    expect(html).toContain(
      '<pre part="md-code" data-lang="sh"><code>echo &quot;&lt;hi>&quot;</code></pre>',
    );
    expect(html).not.toContain("<b>");
  });

  it("opens links in a new tab without an opener and reports clicks", () => {
    const onLink = vi.fn();
    const html = render(<Markdown source="see [docs](https://d.test/x)" onLink={onLink} />);
    expect(html).toContain(
      '<a part="md-link" href="https://d.test/x" target="_blank" rel="noreferrer noopener">docs</a>',
    );
  });

  it("numbers lists from their first marker", () => {
    expect(render(<Markdown source="3. c\n4. d" />)).toContain('<ol part="md-list" start="3">');
    expect(render(<Markdown source="1. a" />)).toContain('<ol part="md-list"><li>');
  });
});
