#!/usr/bin/env node
/**
 * Minimal stub of the Boardgamers REST API for the CI smoke job — no Mongo, no
 * Koa, just the handful of GET endpoints the web home page's SSR touches,
 * answered with empty-but-valid payloads:
 *
 *   GET /boardgame/info            -> []   (game metadata list, root layout)
 *   GET /game/status/<s>           -> []   (open/active game lists, home page)
 *   GET /game/status/<s>/count     -> 0
 *   GET /site/announcement         -> { content: "" }
 *   anything else                  -> 404 JSON (loads treat ApiError as "empty")
 *
 * The web server proxies SSR /api/* fetches here via VITE_backend. Binds
 * 127.0.0.1:50801 (the api's standard port) by default; override with
 * STUB_API_HOST / STUB_API_PORT.
 */
import { createServer } from "node:http";

const host = process.env.STUB_API_HOST ?? "127.0.0.1";
const port = Number(process.env.STUB_API_PORT ?? 50801);

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	// The stub front-proxies /api/* the way nginx does in prod: SSR fetches from
	// the web app arrive at /api/* (rewritten to this host by handleFetch), while
	// direct client-side /api/* calls are proxied here by the boot wrapper
	// (scripts/run-smoke-web.mjs) instead of 404ing on the SvelteKit server.
	const path = url.pathname.replace(/^\/api(?=\/|$)/, "");

	const send = (status, body) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};

	if (req.method !== "GET") {
		return send(404, { message: "stub api: read-only" });
	}
	if (path === "/boardgame/info") {
		return send(200, []);
	}
	if (path === "/site/announcement") {
		return send(200, { content: "" });
	}
	const statusMatch = path.match(/^\/game\/status\/(\w+)(\/count)?$/);
	if (statusMatch) {
		return send(200, statusMatch[2] ? 0 : []);
	}

	send(404, { message: `stub api: no route for ${path}` });
});

server.listen(port, host, () => {
	console.log(`stub-api listening on http://${host}:${port}`);
});
