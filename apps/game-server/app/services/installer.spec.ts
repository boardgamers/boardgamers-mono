// Installer tests:
//  - #268: a GameInfo whose engine.package carries a tarball URL (admin-uploaded
//    bundle) must be npm-installed from that URL (under the engineKey alias), not
//    from the registry. Serves a real `npm pack` tarball over an in-process HTTP
//    server — same fetch path as S3 in prod.
//  - #270: the installer's npm() must stay shell-free — it used
//    `spawn("npm", args, { shell: true })` and Node concatenates args into the
//    shell string UNESCAPED (DEP0190), so a package name with `$(…)` was a
//    game-server RCE. The spawn must pass hostile args literally.
// Run via `pnpm test` (needs a Mongo db — see AGENTS.md).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { colls } from "../config/db.ts";
import { engineKey, enginePath } from "./engines.ts";
import { installNewGames, npm } from "./installer.ts";

const GAME = "installer-test";
const VERSION = 1;
const PKG = { name: "@test/installer-bundle", version: "2.3.1" };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-installer-"));
const tarballPath = path.join(dir, "engine.tgz");
let tarballUrl = "";
let server: http.Server;

// Minimal but complete npm package: dist engine implementing the Engine
// contract well enough to be imported by the bot probe (and enginePath()).
function makeTarball() {
	const pkgDir = path.join(dir, "pkg");
	fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: PKG.name, version: PKG.version, type: "module", main: "dist/engine.mjs" }),
	);
	fs.writeFileSync(
		path.join(pkgDir, "dist", "engine.mjs"),
		`export async function init(players) { return { n: players, moves: 0 }; }
		export async function move(data) { data.moves++; return data; }
		export function ended() { return false; }
		export function scores(data) { return Array(data.n).fill(0); }`,
	);
	// Same layout npm pack produces: a single package/ root in the tarball.
	execFileSync("npm", ["pack", "--pack-destination", dir], { cwd: pkgDir, stdio: "pipe" });
	fs.renameSync(path.join(dir, `test-installer-bundle-${PKG.version}.tgz`), tarballPath);
}

// Archived versions are excluded from the install set: their engine is never
// installed, and a previously-installed copy is pruned as stale. Uses a fake
// (uninstallable) package name so the test fails loudly if the archived engine
// is ever npm-installed.
describe("installer — archived versions are not installed", () => {
	const ARCH_GAME = "installer-archived-test";
	const ARCH_PKG = { name: "@test/installer-archived-bundle", version: "9.9.9" };

	before(async () => {
		// Same isolation as the #268 suite: installNewGames() considers every
		// gameInfo with an engine.
		await colls.gameInfos.deleteMany({ "meta.archived": { $ne: true } });
		await colls.gameInfos.deleteMany({ "_id.game": ARCH_GAME });
		await colls.gameInfos.insertOne({
			_id: { game: ARCH_GAME, version: 1 },
			viewer: { url: "//test/installer-archived" },
			public: true,
			meta: { archived: true, bots: true },
			engine: { package: ARCH_PKG, entryPoint: "dist/engine.mjs" },
		});
	});

	after(async () => {
		await colls.gameInfos.deleteMany({ "_id.game": ARCH_GAME });
	});

	it("skips the archived engine and prunes a previously-installed alias", { timeout: 120_000 }, async () => {
		const key = engineKey(ARCH_GAME, 1, ARCH_PKG);
		const pkgPath = path.join("games", "package.json");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- package.json is untyped by nature
		const pkgBefore = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
		const hadKey = key in (pkgBefore.dependencies ?? {});

		// Simulate a previously-installed engine for the now-archived version.
		fs.mkdirSync(path.join("games", "node_modules", key), { recursive: true });
		if (!hadKey) {
			pkgBefore.dependencies = { ...pkgBefore.dependencies, [key]: `npm:${ARCH_PKG.name}@${ARCH_PKG.version}` };
			fs.writeFileSync(pkgPath, JSON.stringify(pkgBefore));
		}

		try {
			await installNewGames();

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- package.json is untyped by nature
			const pkgAfter = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
			assert.ok(!(key in (pkgAfter.dependencies ?? {})), "archived engine alias is pruned from games/package.json");
			assert.ok(!fs.existsSync(path.join("games", "node_modules", key)), "archived engine directory is removed");
		} finally {
			// Restore games/package.json exactly as found (spec files share ./games).
			if (!hadKey) {
				fs.writeFileSync(pkgPath, JSON.stringify(pkgBefore));
			}
		}
	});
});

describe("installer — engine uploaded as tarball URL (#268)", () => {
	before(async () => {
		// installNewGames() installs EVERY gameInfo with an engine — drop rows for
		// other games so only this suite's fixture is installed (registry installs
		// would hit the network and fail noisily). Spec files are isolated per
		// process and re-insert their own fixtures in their before().
		await colls.gameInfos.deleteMany({ "_id.game": { $ne: GAME } });
		makeTarball();
		server = http.createServer((req, res) => {
			if (req.url === "/engine.tgz") {
				res.setHeader("Content-Type", "application/gzip");
				fs.createReadStream(tarballPath).pipe(res);
			} else {
				res.statusCode = 404;
				res.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address && typeof address === "object");
		tarballUrl = `http://127.0.0.1:${address.port}/engine.tgz`;

		// Only clear this suite's own fixtures — spec files share the test db.
		await colls.gameInfos.deleteMany({ "_id.game": GAME });
		await colls.gameInfos.insertOne({
			_id: { game: GAME, version: VERSION },
			viewer: { url: "//test/installer" },
			public: true,
			meta: {},
			engine: { package: { ...PKG, url: tarballUrl }, entryPoint: "dist/engine.mjs" },
		});
	});

	after(async () => {
		await colls.gameInfos.deleteMany({ "_id.game": GAME });
		server.close();
		fs.rmSync(dir, { recursive: true, force: true });
		// Leave ./games as the installer found it (no uploaded-engine alias).
		fs.rmSync(path.join("games", "node_modules", engineKey(GAME, VERSION, PKG)), { recursive: true, force: true });
	});

	it("npm-installs the engine from the tarball URL and probes it", { timeout: 120_000 }, async () => {
		await installNewGames();

		const key = engineKey(GAME, VERSION, PKG);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- package.json is untyped by nature
		const installed = JSON.parse(fs.readFileSync(path.join("games", "package.json"), "utf-8")) as {
			dependencies?: Record<string, string>;
		};
		// The alias is installed from the tarball URL, not an npm: registry spec.
		assert.strictEqual(installed.dependencies?.[key], tarballUrl);
		assert.ok(fs.existsSync(path.join("games", "node_modules", key, "dist", "engine.mjs")));

		// The install path resolves through engines.ts exactly like a registry engine.
		const entry = await enginePath(GAME, VERSION);
		assert.ok(entry.endsWith(`${key}/dist/engine.mjs`));

		// The bot probe imported the freshly installed engine and recorded the verdict.
		const info = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
		assert.strictEqual(info?.meta?.bots, false);
	});
});

// The shell-injection tests need no db — only a writable CWD.
describe("installer npm() — shell-injection safety (#270)", () => {
	const workdir = process.cwd();

	after(() => process.chdir(workdir));

	it("npm resolves as a direct (shell-free) spawn on this platform", async () => {
		// If `npm` failed to spawn without a shell (ENOENT), this rejects.
		await npm(["--version"]);
	});

	it("an arg with shell metacharacters is passed literally, never executed", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-installer-shell-"));
		const marker = path.join(tmpDir, "pwned");
		fs.mkdirSync(path.join(tmpDir, "games"));
		process.chdir(tmpDir);
		try {
			// With `shell: true` the `$(touch …)` in this arg would run. Without a
			// shell, npm receives it as one literal (invalid) argument and exits
			// non-zero — either way the marker file must never appear.
			await npm(["install", "--no-audit", "--no-fund", `x$(touch ${marker})@1.0.0`]).catch(() => {});
			assert.ok(!fs.existsSync(marker), "shell injection executed — spawn is not shell-free!");
		} finally {
			process.chdir(workdir);
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
