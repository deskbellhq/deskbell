import { createDb } from "./index";
import { organizations, projects } from "./schema";

/**
 * Dev/self-host bootstrap (spec: mvp-end-to-end): idempotent seed of the
 * default workspace, run after migrations (dx.sh, compose migrate service).
 * Fixed IDs so re-runs are no-ops. The empty allowedOrigins list means the
 * ask endpoint is origin-open — dev-only; the hard gate lands with
 * spec: widget-abuse-protection before any public deploy.
 */
const DEFAULT_ORG_ID = "org_dev";
const DEFAULT_PROJECT_ID = "proj_dev";
const DEFAULT_PUBLIC_KEY = "pk_dev_default";

const db = createDb();

await db
  .insert(organizations)
  .values({ id: DEFAULT_ORG_ID, name: "Deskbell Dev", slug: "deskbell-dev" })
  .onConflictDoNothing();

await db
  .insert(projects)
  .values({
    id: DEFAULT_PROJECT_ID,
    orgId: DEFAULT_ORG_ID,
    name: "Default project",
    publicKey: DEFAULT_PUBLIC_KEY,
    allowedOrigins: [],
    // The dashboard dogfoods the widget through the same server-config path a
    // customer uses, so the Deploy page's live preview drives the real thing.
    // Nothing is overridden: a first install shows the widget's own defaults,
    // which are also the brand's.
    appearance: {},
  })
  .onConflictDoNothing();

console.log(`Seeded default workspace: org=${DEFAULT_ORG_ID} project=${DEFAULT_PROJECT_ID}`);
console.log(`Widget project key: ${DEFAULT_PUBLIC_KEY}`);

await db.$client.end();
