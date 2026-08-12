import { spawn } from "node:child_process";
import fs from "fs-extra";
import pkg from "../../package.json" with { type: "json" };
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import type { Engine } from "../types/engine.ts";
import { engineKey, enginePath, refreshEngine } from "./engines.ts";

// Bot support is deduced from the freshly installed engine: an engine that exports
// `moveAI` can host bot players. Persisted on gameInfos.meta.bots so the api/web can
// surface the capability without loading the engine. Failures (engine won't import)
// mean no bots — never block an install on the probe.
async function detectBotSupport(game: string, version: number) {
	try {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engines conform to the Engine contract by convention
		const engine = (await import(await enginePath(game, version))) as Engine;
		const bots = typeof engine.moveAI === "function";
		await colls.gameInfos.updateOne({ _id: { game, version } }, { $set: { "meta.bots": bots } });
		console.log("engine", `${game} v${version}`, "bot support:", bots);
	} catch (err) {
		console.error("could not probe bot support for", `${game} v${version}:`, err);
		await colls.gameInfos.updateOne({ _id: { game, version } }, { $set: { "meta.bots": false } }).catch(() => {});
	}
}

// npm rather than yarn/pnpm: corepack refuses to run yarn inside this repo
// because the root package.json pins "packageManager: pnpm".
function npm(args: string[]): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const process = spawn("npm", args, { shell: true, cwd: "./games" });

		process.on("error", reject);
		process.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`npm ${args.join(" ")} exited with code ${code}`)),
		);
	});
}

let installing = false;

async function initIfNeeded() {
	if (fs.existsSync("./games/package.json")) {
		return;
	}

	await fs.mkdirp("games");
	await fs.writeFile(
		"./games/package.json",
		JSON.stringify({ name: "boardgamers-server-games", version: pkg.version, dependencies: {} }),
	);
}

export async function installNewGames() {
	if (installing) {
		return;
	}
	installing = true;

	// npm install in ./games must run on exactly one process at a time. cron=true already
	// restricts it to the game-server-cron process, and this DB lock (non-blocking —
	// null when held) makes it safe across a PM2 reload overlap.
	await using lock = await locks.lock("engine-install").catch(() => null);
	if (!lock) {
		installing = false;
		return;
	}

	try {
		await initIfNeeded();

		const currentPkg = JSON.parse((await fs.readFile("./games/package.json")).toString("utf-8"));
		const infos = await colls.gameInfos.find({}, { projection: { engine: 1 } }).toArray();

		// Desired dependencies, keyed by a name unique per game+version+package
		// version (engineKey). Because the key changes whenever the engine package
		// version changes, a bumped engine installs to a brand-new path — which is
		// what actually busts the ESM module cache for ongoing games (see
		// engines.ts getEngine). Stale aliases are pruned below.
		const wanted = new Map<string, { spec: string; game: string; version: number }>();
		for (const game of infos) {
			if (!game.engine?.package?.version || !game.engine?.package?.name) {
				continue;
			}
			wanted.set(engineKey(game._id.game, game._id.version, game.engine.package), {
				spec: `npm:${game.engine.package.name}@${game.engine.package.version}`,
				game: game._id.game,
				version: game._id.version,
			});
		}

		const current: Record<string, string> = currentPkg.dependencies ?? {};

		// Probe already-installed engines whose bot support hasn't been deduced yet
		// (e.g. engines installed before this probe existed).
		for (const game of infos) {
			if (game.meta?.bots !== undefined || !game.engine?.package) {
				continue;
			}
			const key = engineKey(game._id.game, game._id.version, game.engine.package);
			if (current[key]) {
				await detectBotSupport(game._id.game, game._id.version);
			}
		}

		// Prune aliases that are no longer wanted (old engine versions, removed games).
		const stale = Object.keys(current).filter((key) => !wanted.has(key));
		if (stale.length > 0) {
			console.log("removing stale engine dependencies", stale);
			await npm(["uninstall", "--no-audit", "--no-fund", ...stale]);
		}

		for (const [key, { spec, game, version }] of wanted) {
			if (current[key] === spec) {
				continue;
			}

			console.log("installing engine", key, spec, "(was", current[key] ?? "none", ")");
			// --save-exact so the written dependency matches `spec` and the install
			// stays idempotent.
			await npm(["install", "--save-exact", "--no-audit", "--no-fund", `${key}@${spec}`]);

			console.log("installed new dependency", key, spec);

			refreshEngine(game, version);
			await detectBotSupport(game, version);
		}
	} catch (err) {
		console.error(err);
	} finally {
		installing = false;
	}
}
