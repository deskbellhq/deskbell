/**
 * Reads a host page's colour scheme off the element it keeps it on
 * (spec: widget-events-lifecycle). Documentation frameworks and CSS
 * frameworks disagree on where: a `dark` class, `data-theme`,
 * `data-color-mode` or `data-bs-theme`. Any of them saying light or dark wins;
 * nothing recognisable means "use the configured scheme".
 */
export interface SchemeAttributes {
  className?: string | null;
  dataTheme?: string | null;
  dataColorMode?: string | null;
  dataBsTheme?: string | null;
}

export function schemeFromAttributes(attrs: SchemeAttributes): "light" | "dark" | null {
  for (const value of [attrs.dataTheme, attrs.dataColorMode, attrs.dataBsTheme]) {
    const v = value?.trim().toLowerCase();
    if (v === "dark" || v === "light") return v;
  }
  const classes = (attrs.className ?? "").toLowerCase().split(/\s+/);
  if (classes.includes("dark")) return "dark";
  if (classes.includes("light")) return "light";
  return null;
}

/** The attributes the observer must watch to notice a scheme change. */
export const SCHEME_ATTRIBUTES = ["class", "data-theme", "data-color-mode", "data-bs-theme"];

export function readScheme(el: Element): "light" | "dark" | null {
  return schemeFromAttributes({
    className: el.getAttribute("class"),
    dataTheme: el.getAttribute("data-theme"),
    dataColorMode: el.getAttribute("data-color-mode"),
    dataBsTheme: el.getAttribute("data-bs-theme"),
  });
}
