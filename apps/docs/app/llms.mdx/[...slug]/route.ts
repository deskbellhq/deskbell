import { notFound } from "next/navigation";
import { getLLMText, source } from "@/lib/source";

/**
 * A page's own Markdown, at `<page path>/content.md`. This is what the copy
 * button copies and what an agent fetches instead of parsing the HTML.
 */
export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  // The route always ends in `content.md`; the rest identifies the page.
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: [...page.slugs, "content.md"] }));
}
