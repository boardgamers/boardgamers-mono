#!/usr/bin/env node
/**
 * Boot the built web app for the CI smoke job, standing in for the piece nginx
 * owns in prod: direct client-side /api/* calls must reach the api — in prod
 * nginx routes them, in dev the vite proxy does, but a bare `node build` lets
 * them 404 on the SvelteKit server (SSR fetches are unaffected: handleFetch
 * rewrites them to VITE_backend directly).
 *
 * This wrapper listens on HOST:PORT (default 127.0.0.1:8612), proxies /api/* to
 * the stub api (VITE_backend, default port 50801) and forwards everything else
 * to the SvelteKit server, which it spawns on an internal port.
 */
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Backgrounded CI steps don't get their stdout collected, which made a silent
// death of this script undebuggable on the runner — mirror key events to a
// file the readiness probe can print on failure.
const statusFile = process.env.SMOKE_STATUS_FILE;
function report(msg) {
	console.log(msg);
	if (statusFile) {
		try {
			appendFileSync(statusFile, `${new Date().toISOString()} ${msg}\n`);
		} catch {}
	}
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8612);
const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));

// Backend resolution mirrors apps/web/src/lib/backend-url.server.ts: VITE_backend
// is a host or host:port, the api lives on 50801 by default.
const rawBackend = (process.env.VITE_backend_api ?? process.env.VITE_backend ?? "127.0.0.1").replace(
	/^https?:\/\//,
	"",
);
const [backendHost, backendPort] = rawBackend.includes(":") ? rawBackend.split(":") : [rawBackend, "50801"];

const internalPort = port + 10000;

report(`smoke web: spawning app (node build in ${webDir}, port ${internalPort})`);

const child = spawn(process.execPath, ["build"], {
	cwd: webDir,
	env: { ...process.env, HOST: "127.0.0.1", PORT: String(internalPort) },
	stdio: "inherit",
});
child.on("exit", (code, signal) => {
	// On the Forgejo runner the child once died without a single line of
	// output, leaving the readiness probe to time out on a 000 — say why.
	report(`smoke web: app process exited (code ${code}, signal ${signal}) before the proxy was up`);
	process.exit(code ?? 1);
});
child.on("error", (err) => {
	report(`smoke web: failed to spawn app process: ${err.message}`);
	process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => child.kill(signal));
}

/** Wait for the SvelteKit server to accept connections before binding ours. */
async function waitForApp(attempts = 100) {
	for (let i = 0; i < attempts; i++) {
		const up = await new Promise((resolve) => {
			const req = request({ host: "127.0.0.1", port: internalPort, path: "/", method: "HEAD" }, () => resolve(true));
			req.on("error", () => resolve(false));
			req.end();
		});
		if (up) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`web app did not come up on 127.0.0.1:${internalPort}`);
}

await waitForApp();

const proxy = createServer((req, res) => {
	const isApi = (req.url ?? "").startsWith("/api/");
	const target = isApi ? { host: backendHost, port: Number(backendPort) } : { host: "127.0.0.1", port: internalPort };
	const upstream = request(
		{
			...target,
			path: req.url,
			method: req.method,
			headers: { ...req.headers, host: `${target.host}:${target.port}` },
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
			upstreamRes.pipe(res);
		},
	);
	upstream.on("error", (err) => {
		res.writeHead(502, { "content-type": "text/plain" });
		res.end(`smoke proxy: ${err.message}`);
	});
	req.pipe(upstream);
});

proxy.listen(port, host, () => {
	report(`smoke web on http://${host}:${port} (app on :${internalPort}, /api -> ${backendHost}:${backendPort})`);
});
