import { conversations } from "@deskbell/db";
import { and, eq, isNull, type SQL } from "drizzle-orm";

/**
 * Who may read, continue, rate, rename or delete a conversation (spec:
 * end-user-identity). One rule, one place: a verified end user owns the rows
 * carrying their id, and an anonymous caller owns the rows carrying their
 * session. The two never mix — a signed-in visitor does not also see the
 * anonymous threads of the browser they happen to be on, and a session id
 * cannot reach a signed-in user's threads.
 *
 * Soft-deleted rows are nobody's: every visitor-facing read goes through
 * here, so `deleted_at` is enforced once.
 */
export interface Caller {
  sessionId: string;
  endUser: { id: string } | null;
}

export function ownedBy(caller: Caller): SQL {
  const owner = caller.endUser
    ? eq(conversations.endUserId, caller.endUser.id)
    : eq(conversations.sessionId, caller.sessionId);
  return and(owner, isNull(conversations.deletedAt)) as SQL;
}
