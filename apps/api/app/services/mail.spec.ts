// Pure-builder spec: no db or server needed (buildMailData only reads env).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import env from "../config/env.ts";
import { buildMailData, type MailKind } from "./mail.ts";

const html = `<p>Hello <b>alice</b>, click <a href="https://${env.site}/user/alice">here</a> to see your games.</p>`;

describe("buildMailData — outbound mail shape (#2)", () => {
	it("derives a plain-text part from the HTML, with the link kept", () => {
		const data = buildMailData({ kind: "your-turn", to: "a@test.com", subject: "Your turn", html });
		assert.ok(data.text, "a text part must be present");
		assert.ok(!data.text.includes("<p>"), "the text part must not contain HTML tags");
		assert.match(data.text, /Hello alice, click here/);
		assert.match(data.text, new RegExp(`https://${env.site.replaceAll(".", "\\.")}/user/alice`));
	});

	it("tags every kind via o:tag", () => {
		const kinds: MailKind[] = ["confirm", "reset", "mail-change", "your-turn", "game-cancelled"];
		for (const kind of kinds) {
			assert.deepEqual(buildMailData({ kind, to: "a@test.com", subject: "s", html })["o:tag"], [kind]);
		}
	});

	it("sets Reply-To to the contact address and From to the Mailgun subdomain", () => {
		const data = buildMailData({ kind: "confirm", to: "a@test.com", subject: "s", html });
		assert.equal(data["h:Reply-To"], env.contact);
		assert.match(String(data.from), new RegExp(`@mg\\.${env.domain.replaceAll(".", "\\.")}>`));
	});

	it("unsubscribable mail carries the RFC 8058 one-click headers and a body link to the landing page", () => {
		const token = "aaaabbbbccccddddeeeeffff.game.some-signature";
		const data = buildMailData({ kind: "your-turn", to: "a@test.com", subject: "s", html, unsubscribeToken: token });
		// The header target is the one-click POST endpoint (RFC 8058)…
		assert.equal(data["h:List-Unsubscribe"], `<https://${env.site}/api/account/unsubscribe/one-click?token=${token}>`);
		assert.equal(data["h:List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
		// …while the body links to the human landing page.
		const pageUrl = `https://${env.site}/unsubscribe?token=${token}`;
		assert.ok(String(data.html).includes(`href="${pageUrl}"`), "the HTML body links to the unsubscribe page");
		assert.ok(data.text?.includes(pageUrl), "the text part links to the unsubscribe page");
	});

	it("transactional mail has no List-Unsubscribe(-Post) and no unsubscribe link", () => {
		for (const kind of ["confirm", "reset", "mail-change"] as const) {
			const data = buildMailData({ kind, to: "a@test.com", subject: "s", html });
			assert.equal(data["h:List-Unsubscribe"], undefined, `${kind} must not set List-Unsubscribe`);
			assert.equal(data["h:List-Unsubscribe-Post"], undefined, `${kind} must not set List-Unsubscribe-Post`);
			assert.ok(!String(data.html).includes("unsubscribe"), `${kind} body must not mention unsubscribing`);
		}
	});
});
