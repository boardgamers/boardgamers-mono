import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId } from "./helpers.ts";

/**
 * bgs user → NodeBB forum uid link, stored in OUR db (we have no write access to
 * the forum's). Filled out-of-band (one-time backfill of legacy session-sharing
 * accounts, matched by email/username) — the OAuth-era link lives in NodeBB's
 * `objects` doc `{ _key: "boardgamersId:uid" }` instead. The dead-user cleanup
 * unions both sources to tell whether a candidate has forum content.
 *
 * `_id` is the bgs user id itself (one link per user; the archive-then-restore
 * flow re-inserts the user with the same id, so the link survives a cleanup
 * false-positive restore).
 */
export const forumUserLinkSchema = z.object({
	_id: zObjectId(),
	/** The user's NodeBB `uid` (`user:<forumUid>`, `uid:<forumUid>:posts`). */
	forumUid: z.number().int().positive(),
});

export type ForumUserLinkDoc = z.output<typeof forumUserLinkSchema>;

export const FORUM_USER_LINKS_COLLECTION = "forumuserlinks";

// Non-unique, matching the index the out-of-band backfill created.
export const forumUserLinkIndexes: IndexDescription[] = [{ key: { forumUid: 1 } }];
