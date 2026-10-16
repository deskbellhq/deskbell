import { loader } from "fumadocs-core/source";
import { llms } from "fumadocs-core/source/llms";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { metaSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { frontmatterSchema } from "./frontmatter-schema";
import { absoluteFromUrl, docsContentRoute, docsRoute } from "./shared";

export { frontmatterSchema };

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema,
    // Required by getLLMText(): keeps the processed Markdown so the raw routes
    // and llms-full.txt serve the same text the page renders.
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [
    lucideIconsPlugin(),
    {
      name: "sidebar-title",
      // The sidebar label is the page title unless the page names a shorter
      // one, so a page titled as a sentence lists as its noun.
      transformPageTree: {
        file(node, filePath) {
          if (!filePath) return node;
          const file = this.storage.read(filePath);
          if (file?.format !== "page") return node;
          const { sidebarTitle } = file.data as { sidebarTitle?: unknown };
          if (typeof sidebarTitle === "string") node.name = sidebarTitle;
          return node;
        },
      },
    },
  ],
});

const llmsIndex = llms(source);

/**
 * llms.txt, with absolute links.
 *
 * The loader emits root-relative URLs because Next prefixes rendered links with
 * `basePath` on its own. A text file gets no such treatment, so `/quickstart`
 * in llms.txt would send an agent to the marketing site instead of the
 * documentation. `llms-index.test.ts` pins it.
 */
export function llmsText(): string {
  return llmsIndex.index().replace(/\]\((\/[^)\s]*)\)/g, (_, url) => `](${absoluteFromUrl(url)})`);
}

/** The route serving a page's own Markdown, for agents and the copy button. */
export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]): string {
  return [docsContentRoute, ...page.slugs, "content.md"].join("/");
}

export async function getLLMText(page: (typeof source)["$inferPage"]): Promise<string> {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${absoluteFromUrl(page.url)})\n\n${processed}`;
}
