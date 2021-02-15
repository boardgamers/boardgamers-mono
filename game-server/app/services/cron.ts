import cluster from "cluster";
import "../config/db";
import env from "../config/env";
import { delay } from "../utils/delay";
import { checkMoveDeadlines, processNextQuit, startNextGame } from "./game";
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
    while (await processNextQuit()) {}

    await delay(1000);
  }
}

async function checkDeadlines() {
  while (1) {
    try {
      await checkMoveDeadlines();
    } catch (err) {
      console.error(err);
    }

    await delay(10 * 1000);
  }
}

if (cluster.isMaster) {
  installGames();

  if (env.cron) {
    startGames();
    processQuits();
    checkDeadlines();
  }
}
