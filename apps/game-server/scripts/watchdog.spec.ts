import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { checkHealth, tick, type WatchdogTarget } from "./watchdog.ts";

function listen(server: Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			resolve(addr && typeof addr === "object" ? addr.port : 0);
		});
	});
}

describe("watchdog", () => {
	let healthy: Server;
	let healthyPort: number;

	before(async () => {
		healthy = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
		healthyPort = await listen(healthy);
	});

	after(() => {
		healthy.close();
	});

	it("checkHealth returns true for a responsive server", async () => {
		assert.equal(await checkHealth({ name: "ok", port: healthyPort }), true);
	});

	it("checkHealth returns false for a dead port (connection refused)", async () => {
		// Port 1 is never listening.
		assert.equal(await checkHealth({ name: "dead", port: 1 }, 500), false);
	});

	it("does not restart before the failure threshold", async () => {
		const target: WatchdogTarget = { name: "dead", port: 1 };
		const state = new Map();
		// failThreshold 3: two ticks → two failures, no restart (pm2Restart would spawn
		// a missing pm2 binary in tests, so reaching it would surface an error here).
		await tick([target], state, { failThreshold: 3 });
		await tick([target], state, { failThreshold: 3 });
		assert.equal(state.get("dead").failures, 2);
	});

	it("a wedged (busy-looped) server fails the health check → detected as hung", async () => {
		// A separate process we can truly wedge without blocking this test's own loop.
		// This reproduces the 2026-08-09 outage: process alive, event loop blocked, HTTP
		// unserved — exactly what the watchdog must catch.
		const child = spawn(
			process.execPath,
			[
				"-e",
				`const http=require("node:http");const s=http.createServer((q,r)=>{if(q.url==="/hang"){for(;;){}}r.writeHead(200);r.end("ok")});s.listen(0,"127.0.0.1",()=>console.log(s.address().port))`,
			],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		try {
			const port = await new Promise<number>((resolve, reject) => {
				let buf = "";
				child.stdout.on("data", (d: Buffer) => {
					buf += d.toString();
					const n = parseInt(buf.trim(), 10);
					if (n > 0) {
						resolve(n);
					}
				});
				child.on("error", reject);
				setTimeout(() => reject(new Error("child did not report port")), 5000);
			});

			const target: WatchdogTarget = { name: "wedged", port };
			// Responsive before the hang.
			assert.equal(await checkHealth(target, 1000), true);

			// Wedge it: fire the /hang request but don't await its (never-coming) response.
			const hangReq = fetch(`http://127.0.0.1:${port}/hang`).catch(() => {});
			void hangReq;
			// Give the child a moment to enter the busy loop.
			await new Promise((r) => setTimeout(r, 200));

			// The health check must now time out → false (this is what triggers a restart).
			assert.equal(await checkHealth(target, 500), false);

			// And tick() counts it as a failure.
			const state = new Map();
			await tick([target], state, { failThreshold: 5 });
			assert.equal(state.get("wedged").failures, 1);
		} finally {
			child.kill("SIGKILL");
		}
	});
});
