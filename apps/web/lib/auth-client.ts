import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, roles } from "@/lib/auth/permissions";

/**
 * Browser-side auth client (spec: dashboard-auth). Base URL is same-origin —
 * the dashboard and /api/auth/* are always served by the same deployment.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles })],
});
