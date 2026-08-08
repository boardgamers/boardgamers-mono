import type { z } from "zod";
import type { IndexDescription } from "mongodb";
import { userSchema } from "./user.ts";
import { zDate, zObjectId } from "./helpers.ts";

// Soft-deleted ("dead") users archived by the api's cleanupDeadUsers cron: the full
// user doc plus when it was archived. The original _id is kept under `userId` — the
// archive's own _id is a fresh one, so a restored-then-re-archived user never hits
// the (unavoidable, always-unique) _id_ index. Restore = re-insert the doc into
// `users` with `_id: userId` (minus `deletedAt`/`userId`).
export const deletedUserSchema = userSchema.omit({ _id: true }).extend({
	_id: zObjectId().optional(),
	userId: zObjectId(),
	deletedAt: zDate(),
});

export type DeletedUserDoc = z.output<typeof deletedUserSchema>;

export const DELETED_USERS_COLLECTION = "deletedUsers";

// Deliberately no unique index on this archive (beyond the mandatory _id_ one, which
// is why the original id lives in `userId` instead): a user that is restored and
// later re-archived must not fail on a constraint. Lookup-friendly non-unique
// indexes only.
export const deletedUserIndexes: IndexDescription[] = [
	// restore / admin lookup by original user id
	{ key: { userId: 1 } },
	// lookup by original username
	{ key: { "account.username": 1 } },
	// primary lookup of the admin infoByName fallback; non-unique on purpose — a
	// restored-then-re-archived user appears twice with the same slug
	{ key: { "security.slug": 1 } },
	// list most-recently archived first
	{ key: { deletedAt: -1 } },
];
