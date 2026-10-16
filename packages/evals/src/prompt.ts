import { createHash } from "node:crypto";

/**
 * A short, stable fingerprint of the system prompt a run used.
 *
 * The grounding contract decides whether an answer is refused, cited or
 * invented, so editing it moves every quality number in the report. Recording
 * the prompt itself would put a moving wall of text in every baseline; twelve
 * hex characters is enough to tell two prompts apart and short enough to read
 * in a diff.
 */
export function promptFingerprint(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}
