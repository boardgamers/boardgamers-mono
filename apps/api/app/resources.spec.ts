// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. The resources server is started by the spec itself on an ephemeral
// port (test-setup only starts the main API).
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { colls, db } from "./config/db.ts";
import env from "./config/env.ts";
import { setup } from "./config/test-setup.ts";
import { listen } from "./resources.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.resources}`;

async function iframeHtml(game: string, query = ""): Promise<string> {
	const res = await fetch(`${baseURL()}/game/${game}/1/iframe${query}`);
	assert.strictEqual(res.status, 200);
	return res.text();
}

describe("Game viewer iframe page", () => {
	let server: Server;

	before(async () => {
		await setup();
		env.listen.port.resources = 0;
		server = await listen();
		const addr = server.address();
		if (addr && typeof addr === "object") {
			env.listen.port.resources = addr.port;
		}

		await colls.gameInfos.insertMany([
			{
				_id: { game: "iframe-test", version: 1 },
				label: "Iframe Test",
				viewer: { url: "//test.com/iframe-test", topLevelVariable: "iframeTest" },
				players: [2],
				public: true,
				meta: {},
			},
			{
				_id: { game: "iframe-clash-test", version: 1 },
				label: "Iframe Clash Test",
				viewer: { url: "//test.com/iframe-clash-test", topLevelVariable: "clash" },
				players: [2],
				public: true,
				meta: {},
			},
		]);
	});

	after(async () => {
		server?.close();
		await db().dropDatabase();
	});

	it("serves a standards-mode document (doctype + <html>) for the standard template", async () => {
		for (const query of ["", "?dark=0", "?dark=1"]) {
			const html = await iframeHtml("iframe-test", query);
			assert.ok(html.startsWith("<!DOCTYPE html>"), `missing doctype (query: ${query})`);
			assert.match(html, /<html/, `missing <html> element (query: ${query})`);
			assert.match(html, /<\/html>/, `missing </html> (query: ${query})`);
			assert.match(html, /<head>/, `missing <head> (query: ${query})`);
			assert.match(html, /<body>/, `missing <body> (query: ${query})`);
		}
	});

	it("serves a standards-mode document (doctype + <html>) for the clash template", async () => {
		for (const query of ["", "?dark=0", "?dark=1"]) {
			const html = await iframeHtml("iframe-clash-test", query);
			assert.ok(html.startsWith("<!DOCTYPE html>"), `missing doctype (query: ${query})`);
			assert.match(html, /<html/, `missing <html> element (query: ${query})`);
			assert.match(html, /<\/html>/, `missing </html> (query: ${query})`);
			assert.match(html, /<canvas id='glcanvas'/, `missing clash canvas (query: ${query})`);
		}
	});

	it("marks the <html> element dark only when dark=1", async () => {
		const dark = await iframeHtml("iframe-test", "?dark=1");
		assert.match(dark, /<html class='dark'>/);

		for (const query of ["", "?dark=0"]) {
			const light = await iframeHtml("iframe-test", query);
			assert.match(light, /<html>/);
			assert.ok(!light.includes("<html class"), `unexpected dark class (query: ${query})`);
		}
	});
});
