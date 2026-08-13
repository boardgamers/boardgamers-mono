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
//
// Never `shell: true` here: args embed `engine.package.name`/`version` straight
// from the DB, and Node concatenates them into the shell string UNESCAPED
// (DEP0190) — a gameInfo with `x$(…)` in the package name was a game-server RCE
// (issue #270). Direct spawn keeps every arg literal. The package name/version
// are also validated at write time (`gameInfoSchema` in @bgs/models) as
// defense-in-depth. Windows note: `npm` is a .cmd shim there, so a direct
// spawn would need "npm.cmd"; prod/dev run on Linux and the extra hardening
// from NOT going through a shell is the point.
export function npm(args: string[]): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawn("npm", args, { cwd: "./games" });
		// npm's own error (E404 for a missing registry package, fetch failure for
		// a tarball URL, …) — without it the log line only says "exited with 1".
		let output = "";
		child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
		child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`npm ${args.join(" ")} exited with code ${code}\n${output.slice(-2000)}`)),
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
		const infos = await colls.gameInfos.find({}, { projection: { engine: 1, "meta.bots": 1 } }).toArray();

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
			// engine.package.url (#268): an admin-uploaded npm-pack tarball hosted
			// on S3 — npm installs remote tarballs under an alias directly
			// (`npm install <alias>@https://…/pkg.tgz`). The URL is content-hashed,
			// so a re-upload is a new spec → re-install into the same alias.
			const spec = game.engine.package.url ?? `npm:${game.engine.package.name}@${game.engine.package.version}`;
			wanted.set(engineKey(game._id.game, game._id.version, game.engine.package), {
				spec,
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
