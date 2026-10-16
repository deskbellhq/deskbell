import Script from "next/script";
import { createElement } from "react";

/**
 * Dogfood the real embed path — script tag + custom element, exactly what
 * customers ship (spec: overview-live-metrics). Rendered by every dashboard
 * shell: the sidebar's Ask a question button opens it via the deskbell:open
 * event, and the appearance editor drives its live preview through the same
 * element (spec: dashboard-ia-settings).
 */
export function WidgetEmbed({ projectKey }: { projectKey: string }) {
  return (
    <>
      <Script src="/deskbell.js" strategy="lazyOnload" />
      {/* No appearance attributes on purpose: branding comes from the project's
          stored appearance via GET /api/v1/config, which is what the Appearance
          page edits. Hardcoding it here would silently beat the editor —
          host-page CSS outranks server config by design. */}
      {createElement("deskbell-widget", { "project-key": projectKey })}
    </>
  );
}
