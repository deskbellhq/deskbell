import { getLLMText, source } from "@/lib/source";

/** Every page as one Markdown document, for pasting into a model's context. */
export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const texts = await Promise.all(pages.map(getLLMText));

  return new Response(texts.join("\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
