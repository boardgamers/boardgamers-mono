import assert from "node:assert";
import cluster from "node:cluster";
import decache from "decache";
import { colls } from "../config/db.ts";
import type { Engine } from "../types/engine.ts";

const engines: Record<string, Engine> = {};

async function requirePath(name: string, version: number) {
  const info = await colls.gameInfos.findOne(
    { _id: { game: name, version } },
    { projection: { "engine.entryPoint": 1 } },
  );
  return `../../games/node_modules/${name}_${version}/${info.engine.entryPoint}`;
}

export async function getEngine(name: string, version: number): Promise<Engine> {
  const key = `${name}_${version}`;

  if (!engines[key]) {
    const path = await requirePath(name, version);
    // @ts-ignore decache types don't match ESM default import
    decache(path);
    engines[key] = await import(path);
  }

  assert(engines[key], "Game server hasn't loaded the engine for this game yet");

  return engines[key];
}

export function refreshEngine(name: string, version: number) {
  console.log("refreshing engine", name, version, cluster.isPrimary);
  delete engines[`${name}_${version}`];

  if (cluster.isPrimary) {
    for (const worker of Object.values(cluster.workers)) {
      worker.send({ type: "refreshEngine", name, version });
    }
  }
}

if (cluster.isWorker) {
  process.on("message", (msg: { type?: string; name?: string; version?: number }) => {
    console.log("received message from master", msg);
    if (msg.type === "refreshEngine") {
      refreshEngine(msg.name, msg.version);
    }
  });
}
