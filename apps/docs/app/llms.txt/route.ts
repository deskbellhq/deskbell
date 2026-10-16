import { llmsText } from "@/lib/source";

/**
 * llmstxt.org index of the documentation.
 *
 * Deskbell answers questions from other people's documentation, so its own
 * being cleanly machine-readable is part of the argument, not decoration.
 */
export const revalidate = false;

export function GET() {
  return new Response(llmsText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
