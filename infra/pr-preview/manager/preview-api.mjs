#!/usr/bin/env node
// preview-api: control plane for ephemeral PR envs, listens on the WireGuard IP only.
//
//   GET    /health
//   GET    /envs                      -> [{pr, sha, status, ports, url, createdAt}]
//   PUT    /envs/:pr   {sha}          create (or update to a new sha); 409 when full
//   DELETE /envs/:pr                  tear down
//   GET    /envs/:pr/nginx?host=<h>   nginx vhost for coyo to serve
//   POST   /seed                      import newest dumps/template as bgs-preview-template
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
const MONGO_URL = "mongodb://10.90.0.2:27017";
const IMAGE = "localhost/bgs-preview:latest";
const MAX_ENVS = 5;
const HOST_DOMAIN = (pr) => `pr-${pr}.boardgamers.space`;

const ports = (pr) => ({
	web: 12000 + Number(pr),
	api: 13000 + Number(pr),
	gameplay: 14000 + Number(pr),
	ws: 15000 + Number(pr),
	resources: 16000 + Number(pr),
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
	const { stdout } = await run(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
	return stdout.trim();
}

async function containerStatus(pr) {
	const name = `bgs-pr-${pr}`;
	try {
		return await sh("podman", ["inspect", "-f", "{{.State.Status}}", name]);
	} catch {
		return "missing";
	}
}

async function createEnv(pr, sha) {
	const state = loadState();
	const existing = state.envs.find((e) => e.pr === pr);
	if (!existing && state.envs.length >= MAX_ENVS) {
		const err = new Error(`max ${MAX_ENVS} envs`);
		err.status = 409;
		throw err;
	}
	if (existing) await deleteEnv(pr);

	const p = ports(pr);
	await sh("podman", [
		"run",
		"-d",
		"--name",
		`bgs-pr-${pr}`,
		"--label",
		"bgs-preview=true",
		"--network",
		"slirp4netns:allow_host_loopback=true",
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

	const env = { pr, sha, url: `https://${HOST_DOMAIN(pr)}`, ports: p, createdAt: new Date().toISOString() };
	state.envs.push(env);
	saveState(state);
	return env;
}

async function deleteEnv(pr) {
	await sh("podman", ["rm", "-f", "-t", "5", `bgs-pr-${pr}`]).catch(() => {});
	const state = loadState();
	state.envs = state.envs.filter((e) => e.pr !== pr);
	saveState(state);
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

async function listEnvs() {
	const state = loadState();
	return Promise.all(state.envs.map(async (e) => ({ ...e, status: await containerStatus(e.pr) })));
}

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
	await sh("podman", [
		"run",
		"--rm",
		"--network",
		"slirp4netns:allow_host_loopback=true",
		"-v",
		`${ROOT}/dumps:/dumps:ro`,
		"docker.io/library/mongo:8",
		"mongorestore",
		`--uri=${MONGO_URL}`,
		"--db=bgs-preview-template",
		"--dir=/dumps/template/bgs-preview-template",
	]);
	return { seeded: true, at: statSync(dumpDir).mtime };
}

function nginxVhost(pr, host) {
	const p = ports(pr);
	const upstream = (port) => `http://${BIND}:${port}`;
	return `# Preview env for PR #${pr} — generated by preview-api on minipc.
# Fetch fresh: curl -H "Authorization: Bearer <secret>" http://10.90.0.2:9900/envs/${pr}/nginx
server {
  server_name ${host};

  location /ws {
    proxy_pass ${upstream(p.ws)};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
  location /api/gameplay { proxy_pass ${upstream(p.gameplay)}; }
  location /api          { proxy_pass ${upstream(p.api)}; }
  location /             { proxy_pass ${upstream(p.web)}; }

  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header Host $host;
  proxy_read_timeout 3600s; # long-polls & slow engine installs
}`;
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
				if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) return json(res, 400, { error: "bad sha" });
				return json(res, 200, await createEnv(pr, sha));
			}
			if (req.method === "DELETE") {
				await deleteEnv(pr);
				return json(res, 200, { deleted: pr });
			}
			if (req.method === "GET" && parts[2] === "nginx") {
				const host = url.searchParams.get("host") ?? HOST_DOMAIN(pr);
				res.writeHead(200, { "content-type": "text/plain" });
				return res.end(nginxVhost(pr, host));
			}
		}
		json(res, 404, { error: "not found" });
	} catch (err) {
		json(res, err.status ?? 500, { error: err.message });
	}
});

server.listen(PORT, BIND, () => console.log(`preview-api on http://${BIND}:${PORT}`));
