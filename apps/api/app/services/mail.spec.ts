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

	it("unsubscribable mail carries List-Unsubscribe and a body link", () => {
		const url = `https://${env.site}/account`;
		const data = buildMailData({ kind: "your-turn", to: "a@test.com", subject: "s", html, unsubscribe: url });
		assert.equal(data["h:List-Unsubscribe"], `<${url}>`);
		assert.ok(String(data.html).includes(`href="${url}"`), "the HTML body links to the unsubscribe URL");
		assert.ok(data.text?.includes(url), "the text part links to the unsubscribe URL");
	});

	it("transactional mail has no List-Unsubscribe and no unsubscribe link", () => {
		for (const kind of ["confirm", "reset", "mail-change"] as const) {
			const data = buildMailData({ kind, to: "a@test.com", subject: "s", html });
			assert.equal(data["h:List-Unsubscribe"], undefined, `${kind} must not set List-Unsubscribe`);
			assert.ok(!String(data.html).includes("unsubscribe"), `${kind} body must not mention unsubscribing`);
		}
	});
});
