/**
 * Clarification setting from environment (spec: clarifying-questions).
 *
 *   DESKBELL_CLARIFY  off (default) | on
 *
 * On, the engine may answer a question that the retrieved context resolves
 * in more than one way with one question back, offering the readings as
 * options. It changes what the visitor gets, so it defaults to today's
 * behaviour and flips only against eval numbers (D8). Same contract as the
 * retrieval knobs: parsed here so the name means one thing everywhere, the
 * engine itself takes a plain option and never reads the environment (D10),
 * and a malformed value warns and falls back to off.
 */
export function clarifyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DESKBELL_CLARIFY?.trim().toLowerCase();
  if (raw === "on") return true;
  if (raw && raw !== "off") {
    console.warn(`[engine] ignoring DESKBELL_CLARIFY="${raw}" — on | off`);
  }
  return false;
}
