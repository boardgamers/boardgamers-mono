import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const newsletterStatusSchema = z.enum(["pending", "sending", "done"]);
export type NewsletterStatus = z.infer<typeof newsletterStatusSchema>;

// A queued newsletter blast (issue #1). The admin route only enqueues; the
// api-cron process delivers in batches, tracking progress on the doc itself so
// a restart mid-blast resumes instead of re-sending.
export const newsletterSchema = z.object({
	_id: zObjectId().optional(),
	subject: z.string(),
	// Markdown source, rendered to HTML at delivery time.
	markdown: z.string(),
	createdBy: zObjectId(),
	status: newsletterStatusSchema,
	// Present (and always 1) exactly while status is pending/sending — the
	// partial unique index below makes a second undelivered blast a
	// duplicate-key error instead of a double mass email.
	active: z.literal(1).optional(),
	// Delivery cursor: recipients are processed in ascending _id order; every
	// user with _id <= lastSentUserId has already been mailed (or skipped), so
	// a resumed run continues strictly after it.
	lastSentUserId: zObjectId().optional(),
	sentCount: z.number().int(),
	// Opted-in recipient count snapshot at enqueue time (the admin UI shows
	// "sending x/y" progress against it).
	recipientCount: z.number().int(),
	errorCount: z.number().int(),
	createdAt: zDate(),
	updatedAt: zDate().optional(),
});

export type NewsletterDoc = z.output<typeof newsletterSchema>;
export type NewsletterFront = Jsonify<NewsletterDoc>;

export const NEWSLETTERS_COLLECTION = "newsletters";

export const newsletterIndexes: IndexDescription[] = [
	// api-cron: pick up the next undelivered blast
	{ key: { status: 1, createdAt: 1 } },
	// At most ONE undelivered blast: the enqueue route relies on this for its
	// atomic 409 (check-then-insert alone races two concurrent sends into a
	// double mass email). `active` is only set for pending/sending docs.
	{ key: { active: 1 }, unique: true, partialFilterExpression: { active: 1 }, name: "active_1" },
];
