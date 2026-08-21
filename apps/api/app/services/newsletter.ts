import { marked } from "marked";
import type { NewsletterDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { signUnsubscribeToken } from "../models/user.ts";
import { sendMail } from "./mail.ts";

// How many emails one cron tick sends per newsletter. The cron ticks every
// minute and sends are 1s apart inside a batch, so the outbound rate caps at
// ~10/min per process — far under Mailgun's limits and gentle on the sending
// domain's reputation.
export const NEWSLETTER_BATCH_SIZE = 10;

// The recipient filter, in one place: an email goes out only to confirmed
// users who opted in to the newsletter (settings.mailing.newsletter === true).
const recipientFilter = {
	"settings.mailing.newsletter": true,
	"security.confirmed": true,
	"account.email": { $exists: true, $ne: "" },
} as const;

export function countNewsletterRecipients(): Promise<number> {
	return colls.users.countDocuments(recipientFilter);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One delivery batch for a queued newsletter: the next NEWSLETTER_BATCH_SIZE
// recipients after the cursor. Progress lands on the doc as it goes (the tick
// after a mid-batch crash resumes after lastSentUserId, never re-sending), so
// the whole loop is idempotent. The doc-level `status` claim (pending →
// sending, matched on status) makes a duplicated cron tick a no-op.
export async function processNewsletterBatch(newsletter: NewsletterDoc): Promise<void> {
	const claimed = await colls.newsletters.updateOne(
		{ _id: newsletter._id, status: "pending" },
		{ $set: { status: "sending" } },
	);
	const resumeAfter = claimed.matchedCount > 0 ? undefined : newsletter.lastSentUserId;

	const recipients = await colls.users
		.find(
			{ ...recipientFilter, ...(resumeAfter ? { _id: { $gt: resumeAfter } } : {}) },
			{ projection: { "account.email": 1 } },
		)
		.sort({ _id: 1 })
		.limit(NEWSLETTER_BATCH_SIZE)
		.toArray();

	if (recipients.length === 0) {
		await colls.newsletters.updateOne({ _id: newsletter._id }, { $set: { status: "done" }, $unset: { active: "" } });
		return;
	}

	const html = marked(newsletter.markdown, { async: false });
	let first = true;
	for (const recipient of recipients) {
		// 1s between sends: ~10/min per process, far under Mailgun's limits.
		if (!first) {
			await sleep(1000);
		}
		first = false;
		try {
			await sendMail({
				kind: "newsletter",
				to: recipient.account.email!,
				subject: newsletter.subject,
				html,
				unsubscribeToken: signUnsubscribeToken(recipient._id.toHexString(), "newsletter"),
			});
			await colls.newsletters.updateOne(
				{ _id: newsletter._id },
				{ $set: { lastSentUserId: recipient._id }, $inc: { sentCount: 1 } },
			);
		} catch (err) {
			console.error(`[newsletter] send to ${recipient._id.toHexString()} failed`, err);
			// The cursor still advances past the failure: one bad address must not
			// stall the blast for everyone after it.
			await colls.newsletters.updateOne(
				{ _id: newsletter._id },
				{ $set: { lastSentUserId: recipient._id }, $inc: { errorCount: 1 } },
			);
		}
	}
}

// Cron task: advance every queued newsletter by one batch. Rarely more than
// one is in flight — the admin UI enqueues one blast at a time.
export async function processNewsletters(): Promise<void> {
	const queue = await colls.newsletters
		.find({ status: { $in: ["pending", "sending"] } })
		.sort({ createdAt: 1 })
		.toArray();
	for (const newsletter of queue) {
		await processNewsletterBatch(newsletter);
	}
}
