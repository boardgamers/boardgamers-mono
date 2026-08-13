import env from "../config/env.ts";
import { processCurrentMove, processGameEnded, processPlayerDrop } from "../models/gamenotification.ts";
import { sendGameNotificationEmail } from "../models/user.ts";
import { colls, closeDb } from "../config/db.ts";
import locks from "../config/locks.ts";
import { cancelOldOpenGames, processSchedulesGames, processStalledGames, processUnreadyGames } from "./game.ts";
import { cleanupDeadUsers } from "./user.ts";
import type { Closable } from "@bgs/utils/log";

const intervals: NodeJS.Timeout[] = [];
const inFlight = new Set<Promise<void>>();

// Run `task` under a short-lived DB lock so exactly one process performs it per tick.
// cron=true already confines these to the api-cron process (or the single dev process);
// the lock makes it safe during the brief overlap of a PM2 reload. lock() is
// non-blocking (null when held), so the loser simply skips the tick. Each tick is
// tracked in `inFlight` so shutdown can wait for it (releasing its lock) before exiting.
function singleton(name: string, task: () => Promise<unknown>) {
	return () => {
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
	};
}

function every(ms: number, task: () => void) {
	intervals.push(setInterval(task, ms));
}

/* Check move deadlines every 10 seconds - only on one thread of the server */
if (env.cron) {
	every(10000, singleton("currentMove", processCurrentMove));
	every(10000, singleton("gameEnded", processGameEnded));
	every(10000, singleton("playerDrop", processPlayerDrop));
	every(1000, singleton("scheduledGames", processSchedulesGames));
	every(5000, singleton("cancelOldOpenGames", cancelOldOpenGames));
	every(10000, singleton("unreadyGames", processUnreadyGames));
	// Inactivity sweep (#94): drops current players whose deadline is long expired,
	// cancels games with no active human left. Hourly is plenty — thresholds are days.
	every(3600 * 1000, singleton("stalledGames", processStalledGames));
	// Dead-user cleanup (archives to deletedUsers; only with cleanupDeadUsers="delete",
	// otherwise dry-run log/off). It self-throttles to at most once per 24h via a
	// persisted lastRunAt, so an hourly tick + a boot-time run catch up after a
	// deploy/restart instead of restarting a 24h countdown.
	const cleanupDeadUsersTick = singleton("cleanupDeadUsers", cleanupDeadUsers);
	every(3600 * 1000, cleanupDeadUsersTick);
	cleanupDeadUsersTick();
}

if (env.automatedEmails) {
	every(
		60000,
		singleton("gameNotificationEmails", async () => {
			const toEmail = await colls.users.find({ "meta.nextGameNotification": { $lte: new Date() } }).toArray();
			await Promise.all(toEmail.map((user) => sendGameNotificationEmail(user)));
		}),
	);
}

/**
 * Closable cron: on close, stop the loops, wait for any in-flight tick to finish (its
 * `await using` releases the DB lock), then close the mongo client. Registered with
 * gracefulShutdown in server.ts so a PM2 reload doesn't kill a tick mid-flight.
 */
export const cron: Closable = {
	close(cb) {
		for (const id of intervals) {
			clearInterval(id);
		}
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
