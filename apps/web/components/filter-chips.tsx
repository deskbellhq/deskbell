import { X } from "lucide-react";
import Link from "next/link";

/**
 * Active filters as chips (spec: usage-page, attention-inbox): the
 * property, the value it is narrowed to, and an × that is a link to the
 * view without it. One component for the Usage page and the inbox, so a
 * filter looks the same wherever it appears.
 */
export interface FilterChip {
  /** The property, as the reader knows it: "Topic", "Outcome", a context key. */
  name: string;
  /** The value, named the way the page names it elsewhere. */
  value: string;
  /** The same view without this filter. */
  clearHref: string;
}

export function FilterChips({ label, chips }: { label: string; chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <li
          key={`${chip.name}:${chip.value}`}
          className="flex min-w-0 items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
        >
          <span className="text-muted-foreground">{chip.name}:</span>
          <span className="truncate font-medium">{chip.value}</span>
          <Link
            href={chip.clearHref}
            aria-label={`Remove ${chip.name} filter`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
