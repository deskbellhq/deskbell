import type { ReactNode } from "react";

/**
 * The one page-title block (spec: dashboard-ia-settings): large title, muted
 * one-line description, optional actions on the right. Description is a
 * ReactNode because several pages set inline <code> in theirs.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
