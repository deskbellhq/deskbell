import { PageHeader } from "@/components/page-header";
import { requireMember } from "@/lib/auth/session";
import { getDefaultProject } from "@/lib/org";

import { IdentityForm } from "./identity-form";

export const dynamic = "force-dynamic";

/**
 * Visitor identity — who the widget recognises (spec: end-user-identity). Off, every
 * visitor is an anonymous session. On, a bearer token from the named issuer
 * makes the visitor a known user whose conversations follow them.
 */
export default async function IdentityPage() {
  const [{ role }, project] = await Promise.all([requireMember(), getDefaultProject()]);
  const canEdit = role === "owner" || role === "admin";

  return (
    <>
      <PageHeader
        title="Visitor identity"
        description={
          <>
            Recognise visitors the embedding page has already signed in. Hand the widget their token
            and the server verifies it here; their conversations then follow them across browsers.
            Without it, history stays with the browser session.
          </>
        }
      />
      <IdentityForm identity={project.identity} canEdit={canEdit} />
    </>
  );
}
