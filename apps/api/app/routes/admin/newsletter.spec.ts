// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { setSendmailForTests, type MailSendData } from "../../config/sendmail.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { verifyUnsubscribeToken } from "../../models/user.ts";
import { processNewsletterBatch, processNewsletters } from "../../services/newsletter.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>, body?: unknown) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

describe("Admin API — newsletter", () => {
	const fullAdminId = new ObjectId();
	const fullAdminEmail = "news-fulladmin@test.com";
	const newsAdminId = new ObjectId();
	const newsAdminEmail = "news-admin@test.com";
	const pagesAdminId = new ObjectId();
	const userId = new ObjectId();

	let fullAdmin: Record<string, string>;
	let newsAdmin: Record<string, string>;
	let pagesAdmin: Record<string, string>;
	let regularUser: Record<string, string>;
	let sentMails: MailSendData[];

	const composeBody = { subject: "Big news", markdown: "Hello **subscribers**!" };

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: fullAdminId,
				account: { username: "news-fulladmin", email: fullAdminEmail },
				security: { slug: "news-fulladmin" },
				authority: "admin",
			}),
		);
		await colls.users.insertOne(
			testUser({
				_id: newsAdminId,
				account: { username: "news-admin", email: newsAdminEmail },
				security: { slug: "news-admin" },
				adminGrants: ["newsletter"],
			}),
		);
		await colls.users.insertOne(testUser({ _id: pagesAdminId, adminGrants: ["pages"] }));
		await colls.users.insertOne(testUser({ _id: userId }));

		fullAdmin = await makeAuthHeaders(fullAdminId);
		newsAdmin = await makeAuthHeaders(newsAdminId);
		pagesAdmin = await makeAuthHeaders(pagesAdminId);
		regularUser = await makeAuthHeaders(userId);

		sentMails = [];
		setSendmailForTests(async (data) => {
			sentMails.push(data);
		});
	});

	after(async () => {
		setSendmailForTests(null);
		await db().dropDatabase();
	});

	describe("permission gating", () => {
		it("newsletter routes require the newsletter grant", async () => {
			for (const headers of [pagesAdmin, regularUser, undefined]) {
				assert.strictEqual((await api("GET", "/api/admin/newsletter", headers)).status, 403);
				assert.strictEqual((await api("GET", "/api/admin/newsletter/count", headers)).status, 403);
				assert.strictEqual((await api("POST", "/api/admin/newsletter/test", headers, composeBody)).status, 403);
				assert.strictEqual((await api("POST", "/api/admin/newsletter/send", headers, composeBody)).status, 403);
			}
			assert.strictEqual((await api("GET", "/api/admin/newsletter/count", newsAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/newsletter/count", fullAdmin)).status, 200);
		});
	});

	describe("POST /api/admin/newsletter/test", () => {
		it("sends one email, to the calling admin's own address only", async () => {
			sentMails = [];
			const res = await api("POST", "/api/admin/newsletter/test", newsAdmin, composeBody);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(sentMails.length, 1);
			assert.strictEqual(sentMails[0].to, newsAdminEmail);
			assert.match(String(sentMails[0].subject), /^\[TEST\] Big news$/);
		});

		it("goes from the newsletter subdomain, tagged newsletter, with a newsletter-scoped unsubscribe", async () => {
			const mail = sentMails[0];
			assert.deepEqual(mail["o:tag"], ["newsletter"]);
			assert.match(
				String(mail.from),
				new RegExp(`^BGS <newsletter@newsletter\\.${env.domain.replaceAll(".", "\\.")}>`),
			);
			assert.ok(mail.text, "a text part must be present");
			assert.match(String(mail.html), /Hello <strong>subscribers<\/strong>!/, "the markdown body is rendered");

			const oneClick = mail["h:List-Unsubscribe"];
			assert.match(String(oneClick), /^<https:\/\/.*\/api\/account\/unsubscribe\/one-click\?token=.+>$/);
			assert.strictEqual(mail["h:List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
			const token = decodeURIComponent(/token=([^>]+)>$/.exec(String(oneClick))![1]);
			assert.deepEqual(verifyUnsubscribeToken(token), { userId: newsAdminId.toHexString(), scope: "newsletter" });
			assert.match(String(mail.html), /\/unsubscribe\?token=/, "the body footer links the landing page");
		});
	});

	describe("POST /api/admin/newsletter/send", () => {
		after(async () => {
			await colls.newsletters.deleteMany({});
		});

		it("enqueues without sending anything synchronously", async () => {
			sentMails = [];
			const res = await api("POST", "/api/admin/newsletter/send", newsAdmin, composeBody);
			assert.strictEqual(res.status, 201, JSON.stringify(res.data));
			assert.strictEqual(sentMails.length, 0, "no email goes out in the request");

			const doc = await colls.newsletters.findOne({ subject: "Big news" });
			assert.ok(doc);
			assert.strictEqual(doc.status, "pending");
			assert.strictEqual(doc.sentCount, 0);
			assert.strictEqual(doc.errorCount, 0);
			assert.strictEqual(doc.markdown, composeBody.markdown);
			assert.deepEqual(doc.createdBy, newsAdminId);
		});

		it("409s while another newsletter is still queued or sending", async () => {
			const res = await api("POST", "/api/admin/newsletter/send", fullAdmin, composeBody);
			assert.strictEqual(res.status, 409);
			assert.strictEqual(await colls.newsletters.countDocuments({}), 1);
		});

		it("a concurrent enqueue hits the unique index and 409s (never 500, never two blasts)", async () => {
			// The partial unique index on `active` allows exactly one undelivered
			// blast: a second direct insert gets a duplicate-key error, which the
			// route maps to 409.
			await assert.rejects(
				colls.newsletters.insertOne({
					subject: "Race",
					markdown: "x",
					createdBy: newsAdminId,
					status: "pending",
					active: 1,
					sentCount: 0,
					recipientCount: 0,
					errorCount: 0,
					createdAt: new Date(),
				}),
				(err: { code?: number }) => {
					assert.strictEqual(err.code, 11000);
					return true;
				},
			);
			assert.strictEqual(await colls.newsletters.countDocuments({}), 1, "still exactly one blast queued");
		});

		it("rejects an empty subject or body", async () => {
			assert.strictEqual(
				(await api("POST", "/api/admin/newsletter/send", newsAdmin, { subject: " ", markdown: "x" })).status,
				400,
			);
			assert.strictEqual(
				(await api("POST", "/api/admin/newsletter/send", newsAdmin, { subject: "x", markdown: "" })).status,
				400,
			);
		});
	});

	describe("cron delivery (processNewsletters)", () => {
		const optedInIds = [new ObjectId(), new ObjectId(), new ObjectId()].sort((a, b) =>
			a.toHexString().localeCompare(b.toHexString()),
		);
		const [optedInA, optedInB, optedInC] = optedInIds;
		const optedOutId = new ObjectId();
		const unconfirmedId = new ObjectId();
		const noEmailId = new ObjectId();

		before(async () => {
			const optedIn = (id: ObjectId, n: string) =>
				testUser({
					_id: id,
					account: { username: n, email: `${n}@test.com` },
					security: { slug: n },
					settings: { mailing: { newsletter: true } },
				});
			await colls.users.insertOne(optedIn(optedInA, "nl-a"));
			await colls.users.insertOne(optedIn(optedInB, "nl-b"));
			await colls.users.insertOne(optedIn(optedInC, "nl-c"));
			await colls.users.insertOne(
				testUser({
					_id: optedOutId,
					account: { username: "nl-out", email: "nl-out@test.com" },
					security: { slug: "nl-out" },
					settings: { mailing: { newsletter: false } },
				}),
			);
			await colls.users.insertOne(
				testUser({
					_id: unconfirmedId,
					account: { username: "nl-unconfirmed", email: "nl-unconfirmed@test.com" },
					security: { slug: "nl-unconfirmed", confirmed: false },
					settings: { mailing: { newsletter: true } },
				}),
			);
			await colls.users.insertOne(
				testUser({
					_id: noEmailId,
					account: { username: "nl-noemail", email: "" },
					security: { slug: "nl-noemail" },
					settings: { mailing: { newsletter: true } },
				}),
			);
		});

		it("the recipient count only covers confirmed, opted-in users with an email", async () => {
			const res = await api("GET", "/api/admin/newsletter/count", newsAdmin);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((res.data as { count: number }).count, 3);
		});

		it("delivers only to opted-in users, resuming from the cursor without re-sending", async () => {
			sentMails = [];
			// Enqueued now that the 3 opted-in users exist, so the snapshot counts them.
			const res = await api("POST", "/api/admin/newsletter/send", newsAdmin, composeBody);
			assert.strictEqual(res.status, 201, JSON.stringify(res.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const newsletterId = new ObjectId((res.data as { _id: string })._id);
			assert.strictEqual(sentMails.length, 0, "enqueueing sends nothing synchronously");

			const doc = (await colls.newsletters.findOne({ _id: newsletterId }))!;
			assert.strictEqual(doc.recipientCount, 3, "the enqueue snapshotted the opted-in count");

			// Batch 1 (a fresh cron tick reads the queue and claims the pending doc).
			await processNewsletterBatch(doc);
			const afterFirst = sentMails.map((m) => m.to);
			assert.strictEqual(afterFirst.length, 3, "all 3 recipients in one batch (the batch size covers them)");
			let current = (await colls.newsletters.findOne({ _id: newsletterId }))!;
			assert.strictEqual(current.status, "sending");
			assert.strictEqual(current.sentCount, 3);
			assert.deepEqual(current.lastSentUserId, optedInC, "the cursor sits past every mailed recipient");

			// Crash-resume style: the next tick re-reads the queue — the pending
			// claim is lost, the cursor alone decides where delivery continues.
			// Everyone is already mailed → the batch is empty and the blast is done.
			await processNewsletterBatch(current);
			assert.strictEqual(sentMails.length, 3, "nobody is mailed twice");
			current = (await colls.newsletters.findOne({ _id: newsletterId }))!;
			assert.strictEqual(current.status, "done");
			assert.strictEqual(current.errorCount, 0);

			const recipients = sentMails.map((m) => String(m.to)).sort();
			assert.deepEqual(recipients, ["nl-a@test.com", "nl-b@test.com", "nl-c@test.com"]);
			assert.ok(!recipients.includes("nl-out@test.com"), "opted-out user never mailed");
			assert.ok(!recipients.includes("nl-unconfirmed@test.com"), "unconfirmed user never mailed");
		});

		it("every delivered email carries a newsletter-scoped unsubscribe (header + footer)", async () => {
			const byEmail = new Map([
				["nl-a@test.com", optedInA],
				["nl-b@test.com", optedInB],
				["nl-c@test.com", optedInC],
			]);
			for (const mail of sentMails) {
				const recipientId = byEmail.get(String(mail.to))!;
				const token = decodeURIComponent(/token=([^>]+)>$/.exec(String(mail["h:List-Unsubscribe"]))![1]);
				assert.deepEqual(verifyUnsubscribeToken(token), { userId: recipientId.toHexString(), scope: "newsletter" });
				assert.deepEqual(mail["o:tag"], ["newsletter"]);
				assert.match(String(mail.from), /^BGS <newsletter@newsletter\./);
			}
		});

		it("a mid-batch failure is counted and skipped, not retried forever", async () => {
			const { insertedId } = await colls.newsletters.insertOne({
				subject: "Second blast",
				markdown: "again",
				createdBy: newsAdminId,
				status: "pending",
				active: 1,
				sentCount: 0,
				recipientCount: 3,
				errorCount: 0,
				createdAt: new Date(),
			});
			sentMails = [];
			let calls = 0;
			setSendmailForTests(async (data) => {
				calls++;
				if (calls === 1) {
					throw new Error("mailgun down");
				}
				sentMails.push(data);
			});

			const queued = (await colls.newsletters.findOne({ _id: insertedId }))!;
			await processNewsletterBatch(queued);
			let doc = (await colls.newsletters.findOne({ _id: insertedId }))!;
			assert.strictEqual(doc.errorCount, 1);
			assert.strictEqual(doc.sentCount, 2);
			assert.deepEqual(doc.lastSentUserId, optedInC, "the cursor advanced past the failed recipient");

			await processNewsletterBatch(doc);
			doc = (await colls.newsletters.findOne({ _id: insertedId }))!;
			assert.strictEqual(doc.status, "done");
			assert.strictEqual(sentMails.length, 2, "the failed recipient is not retried");
		});

		it("processNewsletters picks up queued blasts (the cron entry point)", async () => {
			sentMails = [];
			setSendmailForTests(async (data) => {
				sentMails.push(data);
			});
			await colls.newsletters.insertOne({
				subject: "Third blast",
				markdown: "once more",
				createdBy: newsAdminId,
				status: "pending",
				active: 1,
				sentCount: 0,
				recipientCount: 3,
				errorCount: 0,
				createdAt: new Date(),
			});
			await processNewsletters();
			assert.strictEqual(sentMails.length, 3, "the cron task delivers the queued newsletter");
			assert.strictEqual((await colls.newsletters.findOne({ subject: "Third blast" }))!.status, "sending");
		});
	});

	describe("GET /api/admin/newsletter", () => {
		it("lists blasts with progress, without the markdown body", async () => {
			const res = await api("GET", "/api/admin/newsletter", newsAdmin);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const list = res.data as { subject: string; status: string; sentCount: number; markdown?: string }[];
			assert.strictEqual(list.length, 3);
			assert.deepEqual(
				list.map((n) => n.subject),
				["Third blast", "Second blast", "Big news"],
			);
			assert.deepEqual(
				list.map((n) => n.status),
				["sending", "done", "done"],
			);
			assert.strictEqual(list[0].markdown, undefined, "the list endpoint omits bodies");
		});
	});
});
