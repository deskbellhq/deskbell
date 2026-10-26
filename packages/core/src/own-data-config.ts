/**
 * Own-data fallback setting from environment (spec: own-data-fallback).
 *
 *   DESKBELL_OWN_DATA  off (default) | on
 *
 * The product switches the rule per project, from the project's own reply;
 * this knob exists for the eval harness, which has no project row to read
 * and measures what the engine would do with the rule on. Same contract as
 * the clarification knob: parsed here so the name means one thing
 * everywhere, the engine takes a plain option and never reads the
 * environment (D10), and a malformed value warns and falls back to off.
 */
export function ownDataFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DESKBELL_OWN_DATA?.trim().toLowerCase();
  if (raw === "on") return true;
  if (raw && raw !== "off") {
    console.warn(`[engine] ignoring DESKBELL_OWN_DATA="${raw}" — on | off`);
  }
  return false;
}
