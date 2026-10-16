/**
 * Verification setting from environment (spec: answer-verification).
 *
 *   DESKBELL_VERIFY  on (default) | off
 *
 * On, the engine asks the model to bold the names it asserts and checks each
 * one against the retrieved blocks and the corpus after the answer streams.
 * It changes the prompt and adds a lookup to the answer path, so it shipped
 * off and moved to on against before-and-after eval numbers (D8; the spec's
 * Measurements hold them). Same contract as the clarification knob: parsed
 * here so the name means one thing everywhere, the engine takes a plain
 * option and never reads the environment (D10), and a malformed value warns
 * and falls back to the default.
 */
export function verifyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DESKBELL_VERIFY?.trim().toLowerCase();
  if (raw === "off") return false;
  if (raw && raw !== "on") {
    console.warn(`[engine] ignoring DESKBELL_VERIFY="${raw}" — on | off`);
  }
  return true;
}
