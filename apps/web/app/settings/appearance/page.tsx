import { PageHeader } from "@/components/page-header";
import { getDefaultProject } from "@/lib/org";

import { AppearanceEditor } from "./appearance-editor";

export const dynamic = "force-dynamic";

/**
 * Appearance — brand the widget without touching the embed code.
 *
 * Separate from Install on purpose: installing is a one-off a developer does
 * once, while branding is an ongoing job that often belongs to someone else
 * entirely. The saved config is served to every widget by GET /api/v1/config,
 * so nothing here requires a redeploy (spec: widget-customization).
 */
export default async function AppearancePage() {
  const project = await getDefaultProject();

  return (
    <>
      <PageHeader
        title="Appearance"
        description={
          <>
            The widget in the corner is the live preview — it opens when you arrive and updates as
            you type. Changes go live for every visitor on save. For anything beyond these options,
            use <code>--deskbell-*</code> CSS custom properties, <code>::part()</code> and slots.
          </>
        }
      />
      <AppearanceEditor appearance={project.appearance} />
    </>
  );
}
