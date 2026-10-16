import {
  type Database,
  listRetentionProjects,
  purgeConversationsBatch,
  type RetentionScope,
  recordPurgeRun,
} from "@deskbell/db";
import type { PurgeConversationsJob } from "@deskbell/shared";

/**
 * purge.conversations (spec: conversation-retention): remove conversations
 * past each project's retention window, messages and tool calls with them.
 *
 * Per project, batches of `batch` rows oldest first until a batch comes back
 * short, capped at `maxBatches` per run: the worker is serial, and a first
 * purge over years of history must not hold ingestion for its duration. The
 * next hour continues where this one stopped. Every run is recorded on the
 * project — including one that removed nothing — so the settings page can say
 * when the job last looked.
 *
 * Idempotent: a removed row leaves the predicate. One project's failure is
 * collected and re-thrown after the others have run, so pg-boss retries and
 * no project waits behind a broken one.
 */

export const PURGE_BATCH = 1000;
export const PURGE_MAX_BATCHES = 50;

export interface PurgeDeps {
  /** Every project with a window, or the one the job names. */
  listProjects(): Promise<Array<RetentionScope & { days: number }>>;
  /** Remove up to `limit` rows past the window; how many went. */
  deleteBatch(scope: RetentionScope, days: number, limit: number): Promise<number>;
  /** The status line's facts, written on every run. */
  record(scope: RetentionScope, removed: number, at: Date): Promise<void>;
}

export interface PurgeProjectResult extends RetentionScope {
  days: number;
  removed: number;
  /** The run stopped at the cap with rows left; the next run continues. */
  capped: boolean;
}

export interface PurgeSummary {
  projects: PurgeProjectResult[];
  removed: number;
}

export async function runPurge(
  deps: PurgeDeps,
  job: PurgeConversationsJob,
  opts: { batch?: number; maxBatches?: number; now?: () => Date } = {},
): Promise<PurgeSummary> {
  const batch = opts.batch ?? PURGE_BATCH;
  const maxBatches = opts.maxBatches ?? PURGE_MAX_BATCHES;
  const now = opts.now ?? (() => new Date());

  let scopes = await deps.listProjects();
  if (job.orgId && job.projectId) {
    scopes = scopes.filter((s) => s.orgId === job.orgId && s.projectId === job.projectId);
  }

  const summary: PurgeSummary = { projects: [], removed: 0 };
  const failures: Array<{ projectId: string; error: unknown }> = [];
  for (const scope of scopes) {
    if (scope.days <= 0) continue;
    const result: PurgeProjectResult = { ...scope, removed: 0, capped: false };
    try {
      for (let i = 0; i < maxBatches; i += 1) {
        const went = await deps.deleteBatch(scope, scope.days, batch);
        result.removed += went;
        if (went < batch) break;
        if (i === maxBatches - 1) result.capped = true;
      }
      await deps.record(scope, result.removed, now());
      summary.projects.push(result);
      summary.removed += result.removed;
    } catch (error) {
      failures.push({ projectId: scope.projectId, error });
    }
  }

  if (failures.length > 0) {
    const first = failures[0];
    const detail = first?.error instanceof Error ? first.error.message : String(first?.error);
    throw new Error(
      `purge.conversations failed for ${failures.length} of ${scopes.length} projects ` +
        `(first: ${first?.projectId}: ${detail})`,
      { cause: first?.error },
    );
  }
  return summary;
}

export function createPurgeDeps(db: Database): PurgeDeps {
  return {
    listProjects: () => listRetentionProjects(db),
    deleteBatch: (scope, days, limit) => purgeConversationsBatch(db, scope, days, limit),
    record: (scope, removed, at) => recordPurgeRun(db, scope, removed, at),
  };
}

export async function handlePurgeConversations(
  db: Database,
  job: PurgeConversationsJob,
): Promise<PurgeSummary> {
  return runPurge(createPurgeDeps(db), job);
}
