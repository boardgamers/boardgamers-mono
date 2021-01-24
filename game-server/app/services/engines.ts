import assert from "assert";
import GameInfo from "../models/gameinfo";
import { Engine } from "../types/engine";
import cluster from "cluster";
import decache from "decache";

const engines = {};

async function requirePath(name: string, version: number) {
  const entryPoint = (await GameInfo.findById({ game: name, version }, "engine.entryPoint", { lean: true })).engine
    .entryPoint;
  return `../../games/node_modules/${name}_${version}/${entryPoint}`;
}

export async function getEngine(name: string, version: number): Promise<Engine> {
  const key = `${name}_${version}`;

  if (!engines[key]) {
    const path = await requirePath(name, version);
    decache(path);
    engines[key] = await import(path);
  }

  assert(engines[key], "Game server hasn't loaded the engine for this game yet");

  return engines[key];
}

export function refreshEngine(name: string, version: number) {
  console.log("refreshing engine", name, version, cluster.isMaster);
  delete engines[`${name}_${version}`];

  // Clear whole cache, because a module's depencies may need to be reloaded,
  // as well as all its files
  if (cluster.isMaster) {
    for (const worker of Object.values(cluster.workers)) {
      worker.send({ type: "refreshEngine", name, version });
    }
  }
}

if (cluster.isWorker) {
  process.on("message", (msg) => {
    console.log("received message from master", msg);
    if (msg.type === "refreshEngine") {
      refreshEngine(msg.name, msg.version);
    }
  });
}
