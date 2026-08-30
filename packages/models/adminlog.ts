import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// Audit trail for mutating admin actions (issue #266): who did what to
// whom/what, when. Written by the api's admin audit middleware — every
// successful non-GET request under /api/admin lands here, either as a rich
// explicit event (the route named the action and its target) or as an
// automatic fallback carrying just method + path.
export const adminLogSchema = z.object({
	_id: zObjectId().optional(),
	// Snapshot of the acting admin — the name is denormalized so the trail
	// stays readable after a rename or account deletion.
	admin: z.object({ _id: zObjectId(), name: z.string() }),
	// Dotted event name ("user.setAuthority", "game.cancel"); fallback events
	// use "<METHOD> <path>" (path relative to /api/admin).
	action: z.string(),
	target: z.object({ kind: z.string(), id: z.string(), label: z.string().optional() }).optional(),
	// Loose extra context per action. MUST NOT contain secrets — the audit
	// helper scrubs suspicious keys as a safety net, but call sites are
	// responsible for not passing them in the first place.
	meta: z.record(z.string(), z.unknown()).optional(),
	method: z.string(),
	path: z.string(),
	createdAt: zDate(),
});

export type AdminLogDoc = z.output<typeof adminLogSchema>;
export type AdminLogFront = Jsonify<AdminLogDoc>;

export const ADMIN_LOGS_COLLECTION = "adminlogs";

// Not capped: admin-action volume is tiny and a capped collection could
// silently rotate the trail away. Growth is bounded by the TTL below instead —
// two years is plenty for "who changed this?" archaeology while keeping the
// collection small forever.
export const ADMIN_LOG_TTL_SECONDS = 2 * 365 * 24 * 3600;

export const adminLogIndexes: IndexDescription[] = [
	// api: the audit-log listing sorts by createdAt desc; doubles as the TTL index
	{ key: { createdAt: 1 }, expireAfterSeconds: ADMIN_LOG_TTL_SECONDS },
	// api: filter by acting admin
	{ key: { "admin._id": 1, createdAt: -1 } },
	// api: filter by action
	{ key: { action: 1, createdAt: -1 } },
	// api: filter by target ("everything that happened to user X / game Y")
	{ key: { "target.kind": 1, "target.id": 1, createdAt: -1 } },
];
