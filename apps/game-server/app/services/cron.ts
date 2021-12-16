import GameNotification from "app/models/gamenotification";
import cluster from "cluster";
import "../config/db";
import env from "../config/env";
import { delay } from "../utils/delay";
import { processQuit, startNextGame } from "./game";
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
    try {
      const notifications = await GameNotification.find({ kind: "playerQuit", processed: false }).limit(1000);

      for (const notification of notifications) {
        try {
          await processQuit(notification);
        } catch (err) {
          console.error(err);
        }
      }
    } catch (err) {
      console.error(err);
    }

    await delay(1000);
  }
}

async function processDrops() {
  while (1) {
    try {
      const notifications = await GameNotification.find({ kind: "dropPlayer", processed: false }).limit(1000);

      for (const notification of notifications) {
        try {
          await processQuit(notification);
        } catch (err) {
          console.error(err);
        }
      }
    } catch (err) {
      console.error(err);
    }

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
