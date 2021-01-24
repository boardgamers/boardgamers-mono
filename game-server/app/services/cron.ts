import "../config/db";
import cluster from "cluster";
import { installNewGames } from "./installer";
import { delay } from "../utils/delay";
import { startNextGame, checkMoveDeadlines, processNextQuit } from "./game";
import env from "../config/env";

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

  if (env.chron) {
    startGames();
    processQuits();
    checkDeadlines();
  }
}
