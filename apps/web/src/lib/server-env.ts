import fs from "node:fs";
import { parseEnv } from "node:util";

// Load apps/web/.env into process.env before any server module reads it (the S3
// share-image cache reads S3_* lazily on first request). adapter-node has NO .env
// loading of its own, and PM2 drops node_args (--env-file) when forking — so an
// in-process load is the only path that works everywhere. Mirrors
// apps/api/app/config/env.ts: parseEnv (node:util) + `??=` so real environment
// variables (PM2's env dump) always win over file values. Missing file = no-op.
//
// The path resolves to the web app root, not cwd: PM2 runs web with
// cwd ./apps/web/build, and import.meta.url for this compiled file is under
// build/server/chunks/ — so a fixed relative path lands in the wrong place in one of
// dev/build. Walking up to the nearest package.json is stable for both, and the
// package root is where apps/web/.env lives.
function appRoot(): URL {
	let dir = new URL(".", import.meta.url);
	for (let i = 0; i < 6; i++) {
		if (fs.existsSync(new URL("package.json", dir))) {
			return dir;
		}
		dir = new URL("..", dir);
	}
	// Unreachable in practice (apps/web/package.json is always up-tree).
	return new URL("../../", import.meta.url);
}

const envFile = new URL(".env", appRoot());
if (fs.existsSync(envFile)) {
	for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envFile, "utf8")))) {
		process.env[key] ??= value;
	}
}
