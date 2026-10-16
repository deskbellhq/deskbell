/**
 * Deterministic avatar color per widget session — same session, same hue.
 * Decorative only, so the pool holds none of the three signal hues the
 * dashboard reads meaning into (amber = uncertain, red = destructive,
 * green = certain), and every step keeps white text at 4.5:1 or better.
 */
export const AVATAR_CLASSES = [
  "bg-sky-600",
  "bg-violet-500",
  "bg-indigo-500",
  "bg-cyan-700",
  "bg-fuchsia-600",
  "bg-teal-600",
];

export function avatarClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_CLASSES[Math.abs(hash) % AVATAR_CLASSES.length] as string;
}

export function initialOf(text: string): string {
  const letter = text.match(/\p{L}/u)?.[0];
  return (letter ?? "?").toUpperCase();
}

/** Compact relative time: now, 5m, 3h, 2d, then a short date. */
export function relativeTime(value: Date | string): string {
  const then = new Date(value).getTime();
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
