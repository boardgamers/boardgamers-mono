import { colls, closeDb } from "../config/db.ts";
import env from "../config/env.ts";
import locks from "../config/locks.ts";
import { delay } from "../utils/delay.ts";
import { processQuit, startNextGame } from "./game.ts";
import { installNewGames } from "./installer.ts";
import type { Closable } from "@bgs/utils/log";

// `control.running` gates the loops; close() flips it to stop them. Grouped in one
// object (rather than a bare `let`) so the loop condition reads as externally mutable.
const control = { running: true };
const inFlight = new Set<Promise<void>>();

// Run `task` under a short-lived DB lock so exactly one process performs it per
// iteration. cron=true already confines these to the game-server-cron process (or the
// single dev process); the lock makes it safe during the brief overlap of a PM2 reload.
// lock() is non-blocking (null when held), so the loser just skips that iteration. Each
// iteration is tracked in `inFlight` so shutdown can wait for it (releasing its lock).
async function singleton(name: string, task: () => Promise<unknown>) {
	const tick = (async () => {
		await using lock = await locks.lock("cron", name).catch(() => null);
		if (!lock) {
			return;
		}
		try {
			await task();
		} catch (err) {
			console.error(err);
		}
	})();
	inFlight.add(tick);
	void tick.finally(() => inFlight.delete(tick));
	await tick;
}

// Loop `iter` every `ms` until stopped (close() flips `running`). Unlike setInterval,
// these loops await each iteration so work never overlaps itself.
async function loop(ms: number, iter: () => Promise<void>) {
	while (control.running) {
		await iter();
		await delay(ms);
	}
}

async function installGames() {
	// installNewGames takes its own DB lock (longer npm install); no extra lock here.
	await loop(60 * 1000, installNewGames);
}

async function startGames() {
	await loop(1000, () =>
		singleton("startGames", async () => {
			while (await startNextGame()) {}
		}),
	);
}

async function processNotifications(kind: "playerQuit" | "dropPlayer") {
	await loop(1000, () =>
		singleton(kind, async () => {
			const notifications = await colls.gameNotifications.find({ kind, processed: false }).limit(1000).toArray();

			for (const notification of notifications) {
				try {
					await processQuit(notification);
				} catch (err) {
					console.error(err);
				}
			}
		}),
	);
}

if (env.cron) {
	void installGames();
	void startGames();
	void processNotifications("playerQuit");
	void processNotifications("dropPlayer");
}

/**
 * Closable cron: on close, stop the loops, wait for any in-flight iteration to finish
 * (its `await using` releases the DB lock), then close the mongo client. Registered with
 * gracefulShutdown in server.ts so a PM2 reload doesn't kill an iteration mid-flight.
 */
export const cron: Closable = {
	close(cb) {
		control.running = false;
		void (async () => {
			while (inFlight.size > 0) {
				await Promise.allSettled(inFlight);
			}
			await closeDb().catch(() => {});
		})().then(
			() => cb?.(),
			() => cb?.(),
		);
	},
};
