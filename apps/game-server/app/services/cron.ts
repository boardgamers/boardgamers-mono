import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import locks from "../config/locks.ts";
import { delay } from "../utils/delay.ts";
import { processQuit, startNextGame } from "./game.ts";
import { installNewGames } from "./installer.ts";

// Run `task` under a short-lived DB lock so exactly one process performs it per
// iteration. cron=true already confines these to the game-server-cron process (or the
// single dev process); the lock makes it safe during the brief overlap of a PM2 reload.
// lock() is non-blocking (null when held), so the loser just skips that iteration.
async function singleton(name: string, task: () => Promise<unknown>) {
	await using lock = await locks.lock("cron", name).catch(() => null);
	if (!lock) {
		return;
	}
	try {
		await task();
	} catch (err) {
		console.error(err);
	}
}

async function installGames() {
	while (1) {
		// installNewGames takes its own DB lock (longer npm install); no extra lock here.
		await installNewGames();

		await delay(60 * 1000);
	}
}

async function startGames() {
	while (1) {
		await singleton("startGames", async () => {
			while (await startNextGame()) {}
		});

		await delay(1000);
	}
}

async function processNotifications(kind: "playerQuit" | "dropPlayer") {
	while (1) {
		await singleton(kind, async () => {
			const notifications = await colls.gameNotifications.find({ kind, processed: false }).limit(1000).toArray();

			for (const notification of notifications) {
				try {
					await processQuit(notification);
				} catch (err) {
					console.error(err);
				}
			}
		});

		await delay(1000);
	}
}

if (env.cron) {
	void installGames();
	void startGames();
	void processNotifications("playerQuit");
	void processNotifications("dropPlayer");
}
