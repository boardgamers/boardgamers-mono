import assert from "node:assert";
import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import type { Engine } from "../types/engine.ts";

const engines: Record<string, { path: string; engine: Engine; checkedAt: number }> = {};

/** How long a worker may serve a cached engine before re-checking the installed
 * package version. Only the cron process runs the installer (and refreshEngine),
 * so worker processes must notice a hot-swapped engine on their own — a stale
 * cache here serves outdated stripSecret/currentPlayer to live games. */
const PATH_RECHECK_MS = 30_000;

/** npm-alias key an engine package is installed under in `games/`. Unique per
 * package name+version (see installer.ts) so a new engine version always gets a
 * brand-new install path — which is what actually busts the ESM module cache. */
export function engineKey(game: string, version: number, pkg: { name: string; version: string }): string {
	const name = pkg.name.replace(/^@/, "").replace(/[/@]/g, "-");
	const version_ = pkg.version.replace(/[^0-9A-Za-z.-]/g, "-");
	return `${game}_${version}_${name}_${version_}`;
}

async function requirePath(name: string, version: number) {
	const info = await colls.gameInfos.findOne({ _id: { game: name, version } }, { projection: { engine: 1 } });
	assert(info?.engine?.package && info.engine.entryPoint, `No engine registered for ${name} v${version}`);
	return `../../games/node_modules/${engineKey(name, version, info.engine.package)}/${info.engine.entryPoint}`;
}

/**
 * Absolute file URL for an engine's entry point — the form a worker_thread must
 * import (relative `../../games/...` only resolves against this module, not a worker).
 */
export async function enginePath(name: string, version: number): Promise<string> {
	const rel = await requirePath(name, version);
	return new URL(rel, import.meta.url).href;
}

export async function getEngine(name: string, version: number): Promise<Engine> {
	const key = `${name}_${version}`;

	const cached = engines[key];
	if (cached && Date.now() - cached.checkedAt < PATH_RECHECK_MS) {
		return cached.engine;
	}
	// NOTE: we can't `decache` the previous module here — that only clears the
	// CommonJS require.cache, but engines are loaded via dynamic `import()`
	// (ESM), whose cache decache never touches. Because the import path embeds
	// the package version, a bumped engine resolves to a new, uncached path.
	const path = await requirePath(name, version);
	if (cached && cached.path === path) {
		cached.checkedAt = Date.now();
		return cached.engine;
	}
	const engine: Engine = await import(path);
	assert(engine, "Game server hasn't loaded the engine for this game yet");
	engines[key] = { path, engine, checkedAt: Date.now() };

	return engine;
}

export function refreshEngine(name: string, version: number) {
	if (!env.silent) {
		console.log("refreshing engine", name, version);
	}
	delete engines[`${name}_${version}`];
}
