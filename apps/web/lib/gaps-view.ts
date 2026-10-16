/**
 * The gaps page's URL state (spec: gaps-period-and-ordering,
 * gaps-status-filter, gap-drawer-url-state): the keys of each control and
 * the one builder that turns a view into a link.
 *
 * Its own module, with no imports, because the toolbar is a client component
 * and `./gaps` reaches the database package for the grouping code; a value
 * import from there would pull the driver into the browser bundle.
 */

export type PeriodKey = "7d" | "30d" | "90d" | "all";
export const DEFAULT_PERIOD = "30d" satisfies PeriodKey;

export type SortKey = "recent" | "frequent" | "trending";
export const DEFAULT_SORT: SortKey = "recent";

/**
 * Which clusters a view shows. Open is the default: the page is the list of
 * things to do, and a resolved cluster is done. The resolved view is where
 * answered and resolved gaps go to be reviewed; "all" is both, with the
 * resolved ones sunk to the bottom.
 */
export type StatusKey = "open" | "resolved" | "all";
export const DEFAULT_STATUS: StatusKey = "open";

export interface StatusCounts {
  open: number;
  resolved: number;
  all: number;
}

/** A view of the gaps page; every field is optional and defaults are omitted from the URL. */
export interface GapsView {
  period?: PeriodKey;
  sort?: SortKey;
  status?: StatusKey;
  /** The cluster whose drawer is open (spec: gap-drawer-url-state). */
  gap?: string | null;
  /** The drawer is in writing mode; meaningless without `gap`. */
  write?: boolean;
}

/**
 * The one URL builder for the page, its toolbar and its rows, so that a
 * view is a link and two links to the same view are the same string.
 */
export function gapsHref(pathname: string, view: GapsView): string {
  const params = new URLSearchParams();
  if (view.period && view.period !== DEFAULT_PERIOD) params.set("period", view.period);
  if (view.sort && view.sort !== DEFAULT_SORT) params.set("sort", view.sort);
  if (view.status && view.status !== DEFAULT_STATUS) params.set("status", view.status);
  if (view.gap) {
    params.set("gap", view.gap);
    if (view.write) params.set("write", "1");
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
