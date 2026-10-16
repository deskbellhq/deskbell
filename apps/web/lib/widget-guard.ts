import { projects } from "@deskbell/db";
import { eq } from "drizzle-orm";
import { secondsUntilUtcMidnight, tokensUsedToday } from "./abuse/budget";
import { clientIp, hashIp, isBotUserAgent } from "./abuse/client";
import { acquireSlot, type Slot } from "./abuse/concurrency";
import { abuseConfig } from "./abuse/config";
import { type Bucket, consume } from "./abuse/rate-limit";
import { selfHosts } from "./base-url";
import { getDb } from "./db";
import { type EndUser, touchEndUser } from "./identity/end-users";
import { resolveIdentity } from "./identity/resolve";
import { verifyEndUserToken } from "./identity/verify";
import { checkOrigin, corsHeaders, type OriginVerdict } from "./widget-cors";

/**
 * The one gate every public endpoint passes through (spec:
 * widget-abuse-protection). Before this, each route hand-rolled the same
 * project lookup and origin check, and nothing enforced a rate or a budget.
 *
 * Checks run cheapest-first, in this order:
 *   1. bot       self-identifying crawlers and HTTP libraries       403
 *   2. project   unknown key (the allowlist lives on the row)       404
 *   3. origin    same-origin always passes; else allowlist            403
 *   4. rate      per-IP minute + hour, per-project minute           429
 *   5. identity  bearer token, when the project names an issuer     401
 *   6. budget    the project's daily token budget      (ask only)   429
 *   7. slot      concurrent streams from one IP        (ask only)   429
 *
 * Identity (spec: end-user-identity) sits AFTER origin and rate on purpose:
 * a token never buys a way past the allowlist or the limits, it only says
 * who the caller is. A bad token is refused even where anonymous access is
 * allowed, so a broken integration surfaces instead of degrading silently.
 * The beacon carries no identity.
 *
 * A 429 carries CORS headers and Retry-After: the origin already passed, and
 * without the headers the browser reports a network error, leaving the widget
 * unable to tell "slow down" from "server is down".
 */

type Project = typeof projects.$inferSelect;

export type GuardResult =
  | {
      ok: true;
      project: Project;
      cors: Record<string, string>;
      /** Salted; safe to log. Never the raw address (D12). */
      ipHash: string;
      /** Held only for `kind: "ask"`. ALWAYS release it in a finally. */
      slot: Slot | null;
      /** The verified visitor, or null for an anonymous session (spec: end-user-identity). */
      endUser: EndUser | null;
    }
  | { ok: false; response: Response };

export interface GuardOptions {
  projectKey: string;
  /**
   * - "ask"    spends LLM tokens: every check, plus budget and concurrency.
   * - "read"   cheap authenticated-by-session reads: checks 1–4.
   * - "beacon" the install ping: checks 1, 3 and 4, but NOT the allowlist.
   *
   * "beacon" is the deliberate exception (spec: single-tag-embed-deploy-onboarding
   * decided it, and this spec keeps it): the ping exists to tell an operator
   * "your widget is live on staging.example.com, which is not in your
   * allowlist". Enforcing the allowlist there would silence exactly the message
   * the operator needs, and precisely when they need it — on a fresh install
   * with no origins configured yet. It writes one capped, diagnostic row and
   * returns an empty 204, so there is nothing to read and little to abuse.
   */
  kind: "ask" | "read" | "beacon";
}

/** Errors before the origin is known can't safely echo it; `*` keeps them readable. */
const OPEN = { "access-control-allow-origin": "*" };

export async function guardWidgetRequest(
  request: Request,
  { projectKey, kind }: GuardOptions,
): Promise<GuardResult> {
  const config = abuseConfig();
  const db = getDb();
  const origin = request.headers.get("origin");

  if (config.disabled) {
    const project = await findProject(projectKey);
    if (!project) return { ok: false, response: notFound() };
    const verdict: OriginVerdict = { allowed: true, openToAll: true };
    const cors = corsHeaders(origin, verdict);
    // The off switch disables abuse protection, not authorization: identity
    // is who the caller is, and that question does not go away on a trusted
    // network.
    const who = await identify(request, project, kind, cors);
    if (!who.ok) return who;
    return { ok: true, project, cors, ipHash: "disabled", slot: null, endUser: who.endUser };
  }

  // 1. Free, and the most common junk: agents that announce they are not browsers.
  if (isBotUserAgent(request.headers.get("user-agent"))) {
    return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const ip = clientIp(request.headers, config.trustedProxies);
  const ipHash = ip ? hashIp(ip, config.ipSalt) : "unknown";

  // 2. The allowlist lives on the project row, so the lookup comes first.
  const project = await findProject(projectKey);
  if (!project) {
    // Count the miss anyway: without this, guessing project keys is unlimited.
    await consume(db, [readBucket(ipHash, config.readPerMinute)]).catch(() => {});
    return { ok: false, response: notFound() };
  }

  // 3. Origin binding. A beacon is checked for shape (POST must carry a real
  // Origin) but not against the allowlist — see GuardOptions.kind.
  const verdict = checkOrigin({
    origin,
    allowedOrigins: kind === "beacon" ? [] : project.allowedOrigins,
    method: request.method,
    selfHosts: selfHosts(request.headers),
    config: kind === "beacon" ? { ...config, allowAnyOrigin: true } : config,
  });
  if (!verdict.allowed) {
    return {
      ok: false,
      response: Response.json(
        { error: "Origin not allowed", reason: verdict.reason },
        {
          status: 403,
        },
      ),
    };
  }
  const cors = corsHeaders(origin, verdict);

  // 4. Rate limits — one round-trip for every bucket.
  const buckets: Bucket[] =
    kind === "ask"
      ? [
          { scope: "ask:ip:min", subject: ipHash, windowSeconds: 60, limit: config.askPerMinute },
          { scope: "ask:ip:hr", subject: ipHash, windowSeconds: 3600, limit: config.askPerHour },
          {
            scope: "ask:project:min",
            subject: project.id,
            windowSeconds: 60,
            limit: config.projectPerMinute,
          },
        ]
      : [readBucket(ipHash, config.readPerMinute)];

  const rate = await consume(db, buckets);
  if (!rate.ok) return { ok: false, response: tooManyRequests(rate.retryAfter, cors) };

  // 5. Who is asking. Only once the request has paid its way through the
  // checks above — verification is a signature check and a database write.
  const who = await identify(request, project, kind, cors);
  if (!who.ok) return who;
  const { endUser } = who;

  if (kind !== "ask") return { ok: true, project, cors, ipHash, slot: null, endUser };

  // 5. Daily spend. Read before the answer, written after it — so a request can
  // overshoot by one answer. See the spec for why that beats reserving tokens.
  if (project.dailyTokenBudget > 0) {
    const used = await tokensUsedToday(db, project.id, project.orgId);
    if (used >= project.dailyTokenBudget) {
      return { ok: false, response: tooManyRequests(secondsUntilUtcMidnight(), cors) };
    }
  }

  // 7. Concurrent streams from one caller (per instance — see abuse/concurrency.ts).
  const slot = acquireSlot(ipHash, config.maxConcurrentAsks);
  if (!slot) return { ok: false, response: tooManyRequests(5, cors) };

  return { ok: true, project, cors, ipHash, slot, endUser };
}

/**
 * The identity step (spec: end-user-identity). The decision is pure and
 * tested in ./identity/resolve.ts; this wires the verifier and the row.
 */
async function identify(
  request: Request,
  project: Project,
  kind: GuardOptions["kind"],
  cors: Record<string, string>,
): Promise<{ ok: true; endUser: EndUser | null } | { ok: false; response: Response }> {
  if (kind === "beacon") return { ok: true, endUser: null };
  const outcome = await resolveIdentity({
    authorization: request.headers.get("authorization"),
    identity: project.identity,
    verify: verifyEndUserToken,
  });
  if (outcome.kind === "unauthorized") {
    return { ok: false, response: unauthorized(outcome.reason, cors) };
  }
  if (outcome.kind === "anonymous") return { ok: true, endUser: null };
  const endUser = await touchEndUser(
    getDb(),
    { orgId: project.orgId, projectId: project.id },
    outcome.identity,
  );
  return { ok: true, endUser };
}

/**
 * Reads get their own scope, never the ask scope. Sharing a bucket would make a
 * visitor scrolling their conversation history eat the allowance for asking a
 * question — and the tighter of the two limits would silently govern both.
 */
function readBucket(ipHash: string, limit: number): Bucket {
  return { scope: "read:ip:min", subject: ipHash, windowSeconds: 60, limit };
}

async function findProject(publicKey: string): Promise<Project | undefined> {
  return getDb().query.projects.findFirst({ where: eq(projects.publicKey, publicKey) });
}

function notFound(): Response {
  return Response.json({ error: "Unknown project key" }, { status: 404, headers: OPEN });
}

/**
 * Carries CORS headers like the 429 path: the origin passed, and without them
 * the widget cannot tell "sign in" from "the server is down".
 */
function unauthorized(reason: "missing" | "invalid", cors: Record<string, string>): Response {
  return Response.json(
    { error: "Unauthorized", reason },
    { status: 401, headers: { ...cors, "cache-control": "no-store" } },
  );
}

function tooManyRequests(retryAfter: number, cors: Record<string, string>): Response {
  return Response.json(
    { error: "Rate limited", retryAfter },
    {
      status: 429,
      headers: {
        ...cors,
        "retry-after": String(retryAfter),
        // Retry-After is not on the CORS-safelisted response header list, so the
        // widget cannot read it unless we expose it explicitly.
        "access-control-expose-headers": "retry-after",
        "cache-control": "no-store",
      },
    },
  );
}
