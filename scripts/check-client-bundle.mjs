#!/usr/bin/env node
/**
 * Client-bundle guard: scan the built browser bundles (apps/web/build/client,
 * apps/admin/dist) for server-only package signatures and exit 1 on any hit.
 *
 * Why: a runtime import of a server package (e.g. `@bgs/models` root → mongodb)
 * passes svelte-check AND `vite build` — the bundle builds fine, then crashes in
 * the browser at evaluation time (`class heritage t.EventEmitter is not an
 * object or null`). This script is the last CI gate that inspects what actually
 * ships to the browser.
 *
 * It sniffs chunk *contents* (not filenames) for identifiers that only exist in
 * the real server packages. Every pattern targets an API-shaped identifier (not
 * a prose string like "mongodb://…") so user content — chat messages, locale
 * catalogs — can't false-positive:
 *
 *   mongodb/bson  — driver internals: `new MongoClient(`, TypedEventEmitter
 *                   subclasses, wire-protocol constants
 *   koa           — Koa's own class declarations / `ctx.res.setHeader` plumbing
 *   nodemailer    — `createTransport(` call sites
 *   mongoose      — `modelNames`/`plugin(` mixin internals
 *   passport      — `this.authenticate=` strategy-registry plumbing
 *   node:crypto   — node-only shims (getRandomValues polyfill message)
 *
 * Server-only deps that are build-time-only in these apps (sharp, @aws-sdk,
 * jsdom — used in SSR routes the client never imports) are deliberately not
 * listed; add a signature when a package actually leaks once.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Directories holding browser-shipped assets, whichever exist. */
const targets = [
	{ app: "@bgs/web", dir: "apps/web/build/client" },
	{ app: "@bgs/admin", dir: "apps/admin/dist" },
];

/**
 * [package, human hint, regex]. Patterns must match minified bundles: property
 * access and class/method names survive minification, local variable names do
 * not — so match `new MongoClient(`, never `const mongoClient`.
 */
const signatures = [
	// mongodb driver: its client class and the TypedEventEmitter base whose
	// absence in the browser caused the original hydration crash. The class may
	// extend it through a namespace (`extends o.TypedEventEmitter`), so match the
	// heritage clause rather than a bare identifier.
	["mongodb", "new MongoClient(", /\bnew MongoClient\s*\(/],
	["mongodb", "class extends TypedEventEmitter", /\bclass \w+ extends [\w$.]*TypedEventEmitter\b/],
	["mongodb", "connection-string validation", /\bmongodb\+srv:\/\//],
	// bson ships with mongodb; ObjectId as a *constructor call* is the driver API.
	["bson", "new ObjectId(", /\bnew ObjectId\s*\(/],
	// koa: its Application class + the middleware plumbing that names itself.
	["koa", "Koa Application class", /\bclass Application extends [\w$]*EventEmitter\b/],
	["koa", "koa ctx.res plumbing", /\bctx\.res\.setHeader\b/],
	// nodemailer: the transport factory every caller goes through.
	["nodemailer", "createTransport(", /\bcreateTransport\s*\(/],
	// mongoose: model registry internals.
	["mongoose", "mongoose model registry", /\bmodelNames\s*\(\s*\)\s*{/],
	// passport: strategy registry on the Authenticator instance.
	["passport", "passport authenticate registry", /\bthis\.authenticate\s*=/],
	// node:crypto browser shim error text (vite-node polyfills).
	["node:crypto", "node:crypto shim", /\brandomFillSync is not supported in the browser\b/],
];

function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
		} else if (/\.(js|mjs|cjs|html)$/.test(entry)) {
			yield path;
		}
	}
}

let scanned = 0;
const hits = [];

for (const { app, dir } of targets) {
	const abs = join(root, dir);
	if (!existsSync(abs)) {
		console.log(`- ${app}: ${dir} not present, skipped`);
		continue;
	}
	for (const file of walk(abs)) {
		scanned += 1;
		const content = readFileSync(file, "utf8");
		for (const [pkg, hint, pattern] of signatures) {
			if (pattern.test(content)) {
				hits.push({ app, file: relative(root, file), pkg, hint });
			}
		}
	}
}

if (scanned === 0) {
	console.error(
		"check-client-bundle: no client bundle found (looked for apps/web/build/client, apps/admin/dist) — build first",
	);
	process.exit(1);
}

if (hits.length > 0) {
	console.error(
		`check-client-bundle: server-only package signatures found in the browser bundle (${scanned} files scanned):`,
	);
	for (const { app, file, pkg, hint } of hits) {
		console.error(`  ✖ [${app}] ${file}: ${pkg} (${hint})`);
	}
	console.error(
		"\nA server-only package leaked into client code — it will crash in the browser even though vite build passes.\n" +
			"Trace the import chain (e.g. `pnpm --filter @bgs/web exec vite build --debug` or the bundle visualizer) and import\n" +
			"from a dependency-free subpath instead (e.g. @bgs/models/locale), or make the import type-only.",
	);
	process.exit(1);
}

console.log(`check-client-bundle: OK — no server-only signatures in ${scanned} client files`);
