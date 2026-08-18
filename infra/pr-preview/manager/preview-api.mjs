#!/usr/bin/env node
// preview-api: control plane for ephemeral PR envs, listens on the WireGuard IP only.
//
//   GET    /health
//   GET    /envs                      -> [{pr, sha, status, ports, url, createdAt}]
//   PUT    /envs/:pr   {sha}          create (or update to a new sha); 409 when full
//                                       update swaps the container but KEEPS the env db
//                                       400 when sha isn't a full 40-char commit hash;
//                                       500 when the env container fails to start
//                                       (message carries the unit log tail)
//   DELETE /envs/:pr                  tear down (container + db)
//   POST   /seed                      import newest dumps/template as bgs-preview-template
//
// Public routing (TLS, /api, /ws, /resources, /) is done by a wildcard nginx vhost on
// coyo for pr-<n>.boardgamers.space — see ../coyo-pr-preview.nginx.conf. This service
// only manages the env containers/dbs; it does not generate per-env nginx config.
//
// Auth: `Authorization: Bearer <PREVIEW_SECRET>` on every route except /health.
// The secret lives in ~/.config/bgs-preview/secret (this host only); coyo and the
// GitHub workflow each get a copy.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = process.env.HOME;
const ROOT = `${HOME}/bgs-previews`;
const STATE_FILE = `${ROOT}/envs.json`;
const SECRET = readFileSync(`${HOME}/.config/bgs-preview/secret`, "utf8").trim();
const BIND = process.env.BIND ?? "10.90.0.2";
const PORT = Number(process.env.PORT ?? 9900);
// Envs and the seeder reach Mongo over the `bgs-preview` bridge network by container
// name — NOT via the host. That keeps them off the host loopback entirely (the old
// slirp4netns:allow_host_loopback let a compromised env hit any host loopback service).
const MONGO_URL = "mongodb://bgs-preview-mongo:27017";
const POD_NETWORK = "bgs-preview";
const IMAGE = "localhost/bgs-preview:latest";
const MAX_ENVS = 12;
const HOST_DOMAIN = (pr) => `pr-${pr}.boardgamers.space`;

const ports = (pr) => ({
	web: 12000 + Number(pr),
	api: 13000 + Number(pr),
	gameplay: 14000 + Number(pr),
	ws: 15000 + Number(pr),
	resources: 16000 + Number(pr),
	admin: 17000 + Number(pr),
	docs: 18000 + Number(pr),
});

// Env containers reach mongo the same way the host does (the preview-api runs on the
// host network), via the WireGuard IP it's bound to — not host loopback.

function loadState() {
	try {
		return JSON.parse(readFileSync(STATE_FILE, "utf8"));
	} catch {
		return { envs: [] };
	}
}
function saveState(state) {
	mkdirSync(ROOT, { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(state, null, "\t"));
}

async function sh(cmd, args, opts = {}) {
	const { stdout, stderr } = await run(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
	return (stdout + "\n" + stderr).trim();
}

async function containerStatus(pr) {
	const name = `bgs-pr-${pr}`;
	try {
		return await sh("podman", ["inspect", "-f", "{{.State.Status}}", name]);
	} catch {
		return "missing";
	}
}

// Serialize create/delete per PR: without this, two concurrent PUTs for the same PR
// both pass the "existing"/capacity check before either saves, piling up duplicate
// state entries for one actual container.
const prLocks = new Map();
function withPrLock(pr, fn) {
	const prev = prLocks.get(pr) ?? Promise.resolve();
	const next = prev.then(fn, fn);
	prLocks.set(
		pr,
		next.catch(() => {}),
	);
	return next;
}

async function createEnv(pr, sha) {
	const state = loadState();
	const existing = state.envs.find((e) => e.pr === pr);
	if (!existing && state.envs.length >= MAX_ENVS) {
		const err = new Error(`max ${MAX_ENVS} envs`);
		err.status = 409;
		throw err;
	}
	// Update (PUT for an existing PR): swap the container only — the env db is NOT
	// dropped, so admin-added content survives a code redeploy. Dropping the db is
	// reserved for true deletes (PR closed / janitor reap), see deleteEnv.
	if (existing) await stopContainer(pr);

	const p = ports(pr);
	// Launch via systemd-run so the container (and its rootlessport forwarder) lives in
	// its own transient scope, NOT in preview-api's cgroup. Otherwise a preview-api
	// restart/stop would tear down every live env's port-forwarding (rootlessport is a
	// child of whoever started the container).
	await sh("systemd-run", [
		"--user",
		"--unit",
		`bgs-pr-${pr}`,
		"--collect",
		"podman",
		"run",
		"--rm",
		"--name",
		`bgs-pr-${pr}`,
		"--label",
		"bgs-preview=true",
		// Isolated bridge shared with the mongo container (reached by name). No
		// allow_host_loopback: envs can't touch the minipc's host loopback services.
		// Outbound internet still works (bridge NAT) so engines can npm-install.
		"--network",
		POD_NETWORK,
		// Bound to the WireGuard IP only — envs must not appear on the minipc's LAN.
		"-p",
		`${BIND}:${p.web}:${p.web}`,
		"-p",
		`${BIND}:${p.api}:${p.api}`,
		"-p",
		`${BIND}:${p.gameplay}:${p.gameplay}`,
		"-p",
		`${BIND}:${p.ws}:${p.ws}`,
		"-p",
		`${BIND}:${p.resources}:${p.resources}`,
		"-p",
		`${BIND}:${p.admin}:${p.admin}`,
		"-p",
		`${BIND}:${p.docs}:${p.docs}`,
		"-e",
		`PR=${pr}`,
		"-e",
		`SHA=${sha}`,
		"-e",
		`MONGO_URL=${MONGO_URL}`,
		"-e",
		`WEB_PORT=${p.web}`,
		"-e",
		`API_PORT=${p.api}`,
		"-e",
		`GS_PORT=${p.gameplay}`,
		"-e",
		`WS_PORT=${p.ws}`,
		"-e",
		`RESOURCES_PORT=${p.resources}`,
		"-e",
		`ADMIN_PORT=${p.admin}`,
		"-e",
		`DOCS_PORT=${p.docs}`,
		"-v",
		`${ROOT}/dumps:/dumps:ro`,
		"--security-opt",
		"no-new-privileges",
		"--cap-drop",
		"ALL",
		"--memory",
		"4g",
		"--cpus",
		"4",
		"--pids-limit",
		"512",
		// Writable: the entrypoint fetches/checks out the PR commit, pnpm-installs and
		// builds in /repo, and game-server `npm install`s engines into /repo/games
		// (apps/game-server/app/services/installer.ts). The container is the sandbox
		// boundary instead: rootless, no caps, no-new-privileges, mem/cpu/pids caps.
		"--tmpfs",
		"/tmp:size=2g,mode=1777",
		IMAGE,
	]);

	// Catch instant boot crashes (bad sha, missing dump, …) before claiming success:
	// without this, state gets an entry for a dead container and nginx 502s. The
	// entrypoint's long in-container build runs AFTER the process starts, so
	// "running" means "booted", not "ready" — a short poll is the right check.
	const BOOT_TIMEOUT_MS = 10_000;
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	let status = await containerStatus(pr);
	while (status !== "running" && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 1000));
		status = await containerStatus(pr);
	}
	if (status !== "running") {
		// Grab the failure reason before tearing down: the unit's journal has the
		// entrypoint's output even after the --rm container is gone.
		const logTail = await sh("journalctl", ["--user", "-u", `bgs-pr-${pr}`, "-n", "30", "--no-pager"]).catch(
			(e) => `journalctl failed: ${e.message}`,
		);
		await stopContainer(pr);
		const err = new Error(`env container failed to start (status: ${status}): ${logTail}`);
		err.status = 500;
		throw err;
	}

	// Re-read and replace, not push, so a retried PUT never leaves a duplicate entry
	// for the same PR.
	const fresh = loadState();
	fresh.envs = fresh.envs.filter((e) => e.pr !== pr);
	const env = { pr, sha, url: `https://${HOST_DOMAIN(pr)}`, ports: p, createdAt: new Date().toISOString() };
	fresh.envs.push(env);
	saveState(fresh);
	return env;
}

// Stop the transient scope first (kills the container); podman rm is the fallback
// for anything not under systemd-run. Touches neither state nor the env db.
async function stopContainer(pr) {
	await sh("systemctl", ["--user", "stop", `bgs-pr-${pr}`]).catch(() => {});
	await sh("podman", ["rm", "-f", "-t", "5", `bgs-pr-${pr}`]).catch(() => {});
}

async function dropEnvDb(pr) {
	// db cleanup is best-effort; a leftover db is harmless and reused on next create
	await sh("podman", [
		"exec",
		"bgs-preview-mongo",
		"mongosh",
		"--quiet",
		"--eval",
		`db.getSiblingDB('bgs-pr-${pr}').dropDatabase()`,
	]).catch(() => {});
}

// True delete (PR closed, janitor TTL reap): container + state + db all go.
async function deleteEnv(pr) {
	await stopContainer(pr);
	const state = loadState();
	state.envs = state.envs.filter((e) => e.pr !== pr);
	saveState(state);
	await dropEnvDb(pr);
}

async function listEnvs() {
	const state = loadState();
	return Promise.all(state.envs.map(async (e) => ({ ...e, status: await containerStatus(e.pr) })));
}

// --- janitor -----------------------------------------------------------------
// The workflow's DELETE is best-effort — a network blip, GitHub outage or a killed
// runner would leave an env running forever. The janitor is the backstop: reap any
// env past ENV_TTL_DAYS, plus orphans (a container or db with no entry in state).
// A long-open PR whose env got reaped just respawns on the next push.
const ENV_TTL_DAYS = Number(process.env.ENV_TTL_DAYS ?? 14);
const JANITOR_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function sweep() {
	const state = loadState();
	const known = new Set(state.envs.map((e) => e.pr));
	const cutoff = Date.now() - ENV_TTL_DAYS * 24 * 60 * 60 * 1000;

	// 1. Known envs past their TTL.
	for (const env of state.envs) {
		if (Date.parse(env.createdAt) < cutoff) {
			console.log(`[janitor] reaping pr ${env.pr} (created ${env.createdAt}, older than ${ENV_TTL_DAYS}d)`);
			await deleteEnv(env.pr).catch((e) => console.warn(`[janitor] pr ${env.pr}: ${e.message}`));
		}
	}

	// 2. Orphan containers: bgs-pr-<n> running but not in state.
	const ps = await sh("podman", ["ps", "-a", "--filter", "name=bgs-pr-", "--format", "{{.Names}}"]).catch(() => "");
	for (const name of ps.split("\n").filter(Boolean)) {
		const pr = Number(name.replace("bgs-pr-", ""));
		if (Number.isInteger(pr) && !known.has(pr)) {
			console.log(`[janitor] removing orphan container ${name}`);
			await sh("systemctl", ["--user", "stop", name]).catch(() => {});
			await sh("podman", ["rm", "-f", "-t", "5", name]).catch(() => {});
		}
	}

	// 3. Orphan dbs: bgs-pr-<n> with no live env (and never the shared template).
	const live = new Set(loadState().envs.map((e) => e.pr));
	const dbsOut = await sh("podman", [
		"exec",
		"bgs-preview-mongo",
		"mongosh",
		"--quiet",
		"--eval",
		"db.getMongo().getDBNames().filter((n) => /^bgs-pr-/.test(n)).join('\\n')",
	]).catch(() => "");
	for (const db of dbsOut.split("\n").filter(Boolean)) {
		const pr = Number(db.replace("bgs-pr-", ""));
		if (Number.isInteger(pr) && !live.has(pr)) {
			console.log(`[janitor] dropping orphan db ${db}`);
			await sh("podman", [
				"exec",
				"bgs-preview-mongo",
				"mongosh",
				"--quiet",
				"--eval",
				`db.getSiblingDB('${db}').dropDatabase()`,
			]).catch(() => {});
		}
	}
}

// Sweep on boot (catches anything orphaned while the service was down), then hourly.
sweep().catch((e) => console.warn("[janitor]", e.message));
setInterval(() => sweep().catch((e) => console.warn("[janitor]", e.message)), JANITOR_INTERVAL_MS);

async function seed() {
	const dumpDir = `${ROOT}/dumps/template`;
	const entries = readdirSync(dumpDir);
	if (!entries.includes("bgs-preview-template")) {
		const err = new Error("no dump present in dumps/template — wait for the nightly ship from coyo");
		err.status = 400;
		throw err;
	}
	await sh("podman", [
		"exec",
		"bgs-preview-mongo",
		"mongosh",
		"--quiet",
		"--eval",
		"db.getSiblingDB('bgs-preview-template').dropDatabase()",
	]);
	// mongorestore runs via a one-off container from the same mongo image (tools aren't
	// installed on the host), with the dumps dir bind-mounted in.
	const restoreOut = await sh("podman", [
		"run",
		"--rm",
		"--network",
		POD_NETWORK,
		"-v",
		`${ROOT}/dumps:/dumps:ro`,
		"docker.io/library/mongo:8",
		"mongorestore",
		`--uri=${MONGO_URL}`,
		"--db=bgs-preview-template",
		"--dir=/dumps/template/bgs-preview-template",
	]);
	return { seeded: true, at: statSync(dumpDir).mtime, restoreTail: restoreOut.split("\n").slice(-3).join("\n") };
}

function json(res, code, body) {
	res.writeHead(code, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, "http://x");
	const parts = url.pathname.split("/").filter(Boolean);

	if (url.pathname === "/health") return json(res, 200, { ok: true });
	if (req.headers.authorization !== `Bearer ${SECRET}`) return json(res, 401, { error: "unauthorized" });

	try {
		if (req.method === "GET" && url.pathname === "/envs") {
			return json(res, 200, await listEnvs());
		}
		if (req.method === "POST" && url.pathname === "/seed") {
			return json(res, 200, await seed());
		}
		if (parts[0] === "envs" && parts[1]) {
			const pr = Number(parts[1]);
			if (!Number.isInteger(pr) || pr <= 0) return json(res, 400, { error: "bad pr" });

			if (req.method === "PUT") {
				let body = "";
				for await (const chunk of req) body += chunk;
				const { sha } = JSON.parse(body || "{}");
				// Full 40-char sha only: the entrypoint does `git fetch origin "$SHA"`, which
				// needs a complete hash — a short sha or branch name fetches nothing and the
				// container dies on boot.
				if (!sha || !/^[0-9a-f]{40}$/.test(sha))
					return json(res, 400, { error: "sha must be a full 40-char commit hash" });
				return json(res, 200, await withPrLock(pr, () => createEnv(pr, sha)));
			}
			if (req.method === "DELETE") {
				await withPrLock(pr, () => deleteEnv(pr));
				return json(res, 200, { deleted: pr });
			}
		}
		json(res, 404, { error: "not found" });
	} catch (err) {
		json(res, err.status ?? 500, { error: err.message });
	}
});

server.listen(PORT, BIND, () => console.log(`preview-api on http://${BIND}:${PORT}`));
