import assert from "node:assert";
import { colls } from "../config/db.ts";
import type { Engine } from "../types/engine.ts";

const engines: Record<string, Engine> = {};

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

	if (!engines[key]) {
		// NOTE: we can't `decache` the previous module here — that only clears the
		// CommonJS require.cache, but engines are loaded via dynamic `import()`
		// (ESM), whose cache decache never touches. Because the import path embeds
		// the package version, a bumped engine resolves to a new, uncached path.
		engines[key] = await import(await requirePath(name, version));
	}

	assert(engines[key], "Game server hasn't loaded the engine for this game yet");

	return engines[key];
}

export function refreshEngine(name: string, version: number) {
	console.log("refreshing engine", name, version);
	delete engines[`${name}_${version}`];
}
