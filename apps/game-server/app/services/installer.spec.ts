// Installer test for admin-uploaded engine bundles (#268): a GameInfo whose
// engine.package carries a tarball URL must be npm-installed from that URL
// (under the engineKey alias), not from the registry. Serves a real `npm pack`
// tarball over an in-process HTTP server — same fetch path as S3 in prod.
// Run via `pnpm test` (needs a Mongo db — see AGENTS.md).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { colls, closeDb } from "../config/db.ts";
import { engineKey, enginePath } from "./engines.ts";
import { installNewGames } from "./installer.ts";

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
			label: "Installer test",
			viewer: { url: "//test/installer" },
			players: [2],
			meta: { public: true },
			engine: { package: { ...PKG, url: tarballUrl }, entryPoint: "dist/engine.mjs" },
		});
	});

	after(async () => {
		await colls.gameInfos.deleteMany({ "_id.game": GAME });
		server.close();
		await closeDb();
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
