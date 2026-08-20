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

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function resend(email: string, headers: Record<string, string>) {
	const res = await fetch(`${baseURL()}/api/admin/resend-confirmation`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ email }),
	});
	return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
}

describe("Admin API — resend-confirmation auth email cooldown (#195)", () => {
	const adminId = new ObjectId();
	const targetId = new ObjectId();
	const targetEmail = "resend-target@test.com";
	let adminHeaders: Record<string, string>;
	let sentMails: MailSendData[];

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: adminId,
				account: { username: "cooldown-admin", email: "cooldown-admin@test.com" },
				security: { slug: "cooldown-admin" },
				authority: "admin",
			}),
		);
		await colls.users.insertOne(
			testUser({
				_id: targetId,
				account: { username: "resend-target", email: targetEmail },
				security: { confirmed: false, slug: "resend-target", confirmKey: null },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		adminHeaders = { Authorization: `Bearer ${await createAccessToken(tokenDoc, ["all"], true)}` };

		sentMails = [];
		setSendmailForTests(async (data) => {
			sentMails.push(data);
		});
	});

	it("resends the confirmation email and stamps the cooldown", async () => {
		const res = await resend(targetEmail, adminHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(sentMails.filter((m) => String(m.to) === targetEmail).length, 1);
		const user = (await colls.users.findOne({ _id: targetId }))!;
		assert.ok(user.security.confirmKey, "a fresh confirm key is stored");
		assert.ok(user.security.lastAuthEmailSentAt);
	});

	it("the confirmation email is shaped per #2: text part, tag, Reply-To, subdomain From, no unsubscribe", async () => {
		const mail = sentMails.find((m) => String(m.to) === targetEmail)!;
		assert.deepEqual(mail["o:tag"], ["confirm"]);
		assert.equal(mail["h:Reply-To"], env.contact);
		assert.match(String(mail.from), new RegExp(`@mg\\.${env.domain.replaceAll(".", "\\.")}>`));
		assert.ok(mail.text, "a text part must be present");
		assert.match(mail.text, new RegExp(`https://${env.site.replaceAll(".", "\\.")}/confirm\\?key=`));
		assert.equal(mail["h:List-Unsubscribe"], undefined);
		assert.ok(!String(mail.html).includes("unsubscribe"));
	});

	it("a resend within the cooldown sends nothing, keeps the key, still 200s", async () => {
		const keyBefore = (await colls.users.findOne({ _id: targetId }))!.security.confirmKey;
		sentMails = [];
		const res = await resend(targetEmail, adminHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(sentMails.filter((m) => String(m.to) === targetEmail).length, 0);
		assert.strictEqual((await colls.users.findOne({ _id: targetId }))!.security.confirmKey, keyBefore);
	});

	it("still 404s on an unknown email", async () => {
		const res = await resend("no-such-user-195b@test.com", adminHeaders);
		assert.strictEqual(res.status, 404);
	});

	after(() => {
		setSendmailForTests(null);
		return db().dropDatabase();
	});
});
