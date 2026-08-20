import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { marked } from "marked";
import { z } from "zod";
import type { NewsletterDoc } from "@bgs/models";
import { colls } from "../../config/db.ts";
import { signUnsubscribeToken } from "../../models/user.ts";
import { sendMail } from "../../services/mail.ts";
import { countNewsletterRecipients } from "../../services/newsletter.ts";

const router = new Router<Application.DefaultState, Context>();

const composeSchema = z.object({
	subject: z.string().trim().min(1).max(200),
	markdown: z.string().trim().min(1).max(50_000),
});

// POST /api/admin/newsletter/test — one immediate copy to the caller's own
// address. The required look-before-you-blast step: it renders exactly what
// subscribers will receive (same kind, from-address, unsubscribe footer).
router.post("/test", async (ctx) => {
	const { subject, markdown } = composeSchema.parse(ctx.request.body);
	const admin = ctx.state.user!;
	if (!admin.account.email) {
		throw createError(400, "Your account has no email address to send the test to");
	}

	await sendMail({
		kind: "newsletter",
		to: admin.account.email,
		subject: `[TEST] ${subject}`,
		html: marked(markdown, { async: false }),
		unsubscribeToken: signUnsubscribeToken(admin._id.toHexString(), "newsletter"),
	});

	ctx.status = 200;
	ctx.body = { to: admin.account.email };
});

// GET /api/admin/newsletter/count — live opted-in recipient count, shown next
// to the send button and re-checked in the confirmation dialog.
router.get("/count", async (ctx) => {
	ctx.body = { count: await countNewsletterRecipients() };
});

// POST /api/admin/newsletter/send — enqueue the blast; the api-cron process
// delivers it in batches (never synchronously here). One undelivered
// newsletter at a time keeps the queue — and the confirmation dialog — honest.
router.post("/send", async (ctx) => {
	const { subject, markdown } = composeSchema.parse(ctx.request.body);

	if ((await colls.newsletters.countDocuments({ status: { $in: ["pending", "sending"] } })) > 0) {
		throw createError(409, "A newsletter is already queued or sending — wait for it to finish");
	}

	const now = new Date();
	const doc: NewsletterDoc = {
		subject,
		markdown,
		createdBy: ctx.state.user!._id,
		status: "pending",
		active: 1,
		sentCount: 0,
		recipientCount: await countNewsletterRecipients(),
		errorCount: 0,
		createdAt: now,
	};
	let insertedId;
	try {
		({ insertedId } = await colls.newsletters.insertOne(doc));
	} catch (err) {
		// Two concurrent sends raced past the check above — the partial unique
		// index on `active` lets exactly one through.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
		if ((err as { code?: number })?.code === 11000) {
			throw createError(409, "A newsletter is already queued or sending — wait for it to finish");
		}
		throw err;
	}

	ctx.status = 201;
	ctx.body = { _id: insertedId, recipientCount: doc.recipientCount };
});

// GET /api/admin/newsletter — recent blasts with their delivery progress
// (pending / sending x/y / done), newest first.
router.get("/", async (ctx) => {
	ctx.body = await colls.newsletters
		.find({}, { projection: { markdown: 0 } })
		.sort({ createdAt: -1 })
		.limit(20)
		.toArray();
});

export default router;
