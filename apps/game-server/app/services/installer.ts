import { spawn } from "child_process";
import fs from "fs-extra";
import pkg from "../../package.json" with { type: "json" };
import { colls } from "../config/db.ts";
import { refreshEngine } from "./engines.ts";

let installing = false;

async function initIfNeeded() {
  if (fs.existsSync("./games/package.json")) {
    return;
  }

  await fs.mkdirp("games");
  await fs.writeFile(
    "./games/package.json",
    JSON.stringify({ name: "boardgamers-server-games", version: pkg.version, dependencies: {} })
  );
}

export async function installNewGames() {
  if (installing) {
    return;
  }

  try {
    await initIfNeeded();

    const currentPkg = JSON.parse((await fs.readFile("./games/package.json")).toString("utf-8"));
    const infos = await colls.gameInfos.find({}, { projection: { engine: 1 } }).toArray();

    for (const game of infos) {
      if (!game.engine?.package?.version || !game.engine?.package?.name) {
        continue;
      }

      const key = `${game._id.game}_${game._id.version}`;
      const value = `npm:${game.engine.package.name}@${game.engine.package.version}`;

      if (currentPkg.dependencies?.[key] !== value) {
        console.log("old version", currentPkg.dependencies?.[key], "new version", value);
        await new Promise((resolve, reject) => {
          const process = spawn("yarn", ["add", `${key}@${value}`], {
            shell: true,
            cwd: "./games",
          });

          process.on("error", reject);
          process.on("close", resolve);
        });

        console.log(
          "installed new dependency",
          `${game._id.game}_${game._id.version}`,
          `npm:${game.engine.package.name}@${game.engine.package.version}`
        );

        refreshEngine(game._id.game, game._id.version);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    installing = false;
  }
}
