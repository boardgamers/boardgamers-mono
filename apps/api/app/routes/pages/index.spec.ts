// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function getPage(path: string, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}/api/page${path}`, { headers });
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

interface PageBody {
	_id: { name: string; lang: string };
	title: string;
	content: string;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
const pageBody = (res: { data: unknown }) => res.data as PageBody;

describe("Pages API — language negotiation (#306)", () => {
	before(async () => {
		// Clean slate: specs share the *-test db, and this one asserts on exact
		// {name, lang} rows.
		await colls.pages.deleteMany({});
		await colls.pages.insertMany([
			{ _id: { name: "about", lang: "en" }, title: "About", content: "English about" },
			{ _id: { name: "about", lang: "de" }, title: "Über", content: "Deutsche Infos" },
			{ _id: { name: "faq", lang: "en" }, title: "FAQ", content: "English only" },
			{ _id: { name: "contact", lang: "en" }, title: "Contact", content: "English contact" },
			{ _id: { name: "contact", lang: "pt-BR" }, title: "Contato", content: "Conteúdo em português" },
		]);
	});

	after(() => db().dropDatabase());

	it("serves the en version when the request carries no language hint", async () => {
		const res = await getPage("/about");
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "en" });
	});

	it("serves the de version when Accept-Language prefers de and a de row exists", async () => {
		const res = await getPage("/about", { "Accept-Language": "de-DE,de;q=0.9" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
		assert.strictEqual(pageBody(res).title, "Über");
	});

	it("falls back to en when the page has no row in the Accept-Language language", async () => {
		const res = await getPage("/faq", { "Accept-Language": "de-DE,de;q=0.9" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "faq", lang: "en" });
	});

	it("serves the de version when the lang cookie says de", async () => {
		const res = await getPage("/about", { Cookie: "lang=de" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
	});

	it("the lang cookie beats Accept-Language", async () => {
		const res = await getPage("/about", { Cookie: "lang=de", "Accept-Language": "fr-FR,fr;q=0.9" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
	});

	it("a junk lang cookie is treated as absent (en fallback, no error)", async () => {
		// Junk VALUES in an otherwise well-formed lang cookie — each must not be
		// interpolated into the Mongo query (operator injection) nor crash.
		for (const junk of ["../../etc", "de%22%2C%22%24gt%22%3A%22%22", "xxxx-long-value", "de%3B%24gt%3A"]) {
			const res = await getPage("/about", { Cookie: `lang=${junk}` });
			assert.strictEqual(res.status, 200, `cookie lang=${junk}`);
			assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "en" }, `cookie lang=${junk}`);
		}
		// A malformed cookie PAIR (`lang=de;$gt:` parses as lang=de plus a stray
		// "$gt" crumb): the well-formed lang value still applies, and the request
		// must not error out on the stray crumb.
		const res = await getPage("/about", { Cookie: "lang=de;$gt:" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
	});

	it("a junk lang cookie falls through to Accept-Language", async () => {
		const res = await getPage("/about", { Cookie: "lang=../../etc", "Accept-Language": "de" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
	});

	it("serves the pt-BR row when the lang cookie says pt-BR (region subtag survives negotiation)", async () => {
		const res = await getPage("/contact", { Cookie: `lang=${encodeURIComponent("pt-BR")}` });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "contact", lang: "pt-BR" });
	});

	it("serves the pt-BR row when Accept-Language prefers pt-BR", async () => {
		const res = await getPage("/contact", { "Accept-Language": "pt-BR,pt;q=0.9" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "contact", lang: "pt-BR" });
	});

	it("a bare pt request matches pt-BR content via the regional default", async () => {
		const res = await getPage("/contact", { "Accept-Language": "pt" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(pageBody(res)._id, { name: "contact", lang: "pt-BR" });
	});

	it("404s a page that exists in no language", async () => {
		const res = await getPage("/no-such-page", { "Accept-Language": "de" });
		assert.strictEqual(res.status, 404);
	});

	it("GET /page lists en pages only (sitemap source)", async () => {
		const res = await getPage("", { "Accept-Language": "de" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const ids = (res.data as PageBody[]).map((p) => p._id);
		assert.deepStrictEqual(ids, [
			{ name: "about", lang: "en" },
			{ name: "contact", lang: "en" },
			{ name: "faq", lang: "en" },
		]);
	});

	describe("GET /page/:page/:lang (explicit escape hatch)", () => {
		it("serves the exact requested language, ignoring cookie/header", async () => {
			const res = await getPage("/about/de", { Cookie: "lang=fr", "Accept-Language": "fr" });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(pageBody(res)._id, { name: "about", lang: "de" });
		});

		it("404s when the exact {name, lang} row does not exist (no en fallback)", async () => {
			const res = await getPage("/about/fr");
			assert.strictEqual(res.status, 404);
		});
	});
});
