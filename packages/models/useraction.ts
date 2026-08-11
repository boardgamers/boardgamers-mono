import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// Fixed-window counters backing the per-authenticated-user action rate limiter
// (apps/api services/actionratelimit.ts, issue #195). One doc per
// (userId, action, windowStart); `count` is $inc-ed per hit.
export const userActionSchema = z.object({
	_id: zObjectId().optional(),
	userId: zObjectId(),
	// Logical action name chosen by the caller, e.g. "account/email".
	action: z.string().min(1),
	// Start of the fixed window this doc counts (epoch ms, floored to windowMs).
	windowStart: z.number().int().nonnegative(),
	count: z.number().int().nonnegative(),
	// windowStart + 2 windows — the TTL index below reclaims the doc once a
	// window can no longer be current.
	expiresAt: zDate(),
});

export type UserActionDoc = z.output<typeof userActionSchema>;

export const USER_ACTIONS_COLLECTION = "useractions";

export const userActionIndexes: IndexDescription[] = [
	// api: one counter doc per user+action+window; the upsert relies on this to
	// dedupe concurrent first hits (E11000 → replay as a plain $inc).
	{
		key: { userId: 1, action: 1, windowStart: 1 },
		unique: true,
		name: "user_action_window_unique",
	},
	// mongo: reclaim counters two windows after their window starts. Rate
	// limiting never relies on this — expiry comes from the window math; it
	// just bounds collection size.
	{
		key: { expiresAt: 1 },
		expireAfterSeconds: 0,
		name: "expiresAt_ttl",
	},
];
