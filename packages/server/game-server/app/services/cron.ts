import cluster from "cluster";
import "../config/db";
import env from "../config/env";
import { delay } from "../utils/delay";
import { processNextQuit, startNextGame } from "./game";
import { installNewGames } from "./installer";

async function installGames() {
  while (1) {
    await installNewGames();

    await delay(60 * 1000);
  }
}

async function startGames() {
  while (1) {
    while (await startNextGame()) {}

    await delay(1000);
  }
}

async function processQuits() {
  while (1) {
    while (await processNextQuit("playerQuit")) {}

    await delay(1000);
  }
}

async function processDrops() {
  while (1) {
    while (await processNextQuit("dropPlayer")) {}

    await delay(1000);
  }
}

if (cluster.isMaster) {
  void installGames();

  if (env.cron) {
    void startGames();
    void processQuits();
    void processDrops();
  }
}
