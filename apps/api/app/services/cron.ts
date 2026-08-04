import env from "../config/env.ts";
import { processCurrentMove, processGameEnded, processPlayerDrop } from "../models/gamenotification.ts";
import { sendGameNotificationEmail } from "../models/user.ts";
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import { cancelOldOpenGames, processSchedulesGames, processUnreadyGames } from "./game.ts";

// Run `task` under a short-lived DB lock so exactly one process performs it per tick.
// cron=true already confines these to the api-cron process (or the single dev process);
// the lock makes it safe during the brief overlap of a PM2 reload. lock() is
// non-blocking (null when held), so the loser simply skips the tick.
function singleton(name: string, task: () => Promise<unknown>) {
	return async () => {
		await using lock = await locks.lock("cron", name).catch(() => null);
		if (!lock) {
			return;
		}
		try {
			await task();
		} catch (err) {
			console.error(err);
		}
	};
}

/* Check move deadlines every 10 seconds - only on one thread of the server */
if (env.cron) {
	setInterval(singleton("currentMove", processCurrentMove), 10000);
	setInterval(singleton("gameEnded", processGameEnded), 10000);
	setInterval(singleton("playerDrop", processPlayerDrop), 10000);
	setInterval(singleton("scheduledGames", processSchedulesGames), 1000);
	setInterval(singleton("cancelOldOpenGames", cancelOldOpenGames), 5000);
	setInterval(singleton("unreadyGames", processUnreadyGames), 10000);
}

if (env.automatedEmails) {
	setInterval(
		singleton("gameNotificationEmails", async () => {
			const toEmail = await colls.users.find({ "meta.nextGameNotification": { $lte: new Date() } }).toArray();
			await Promise.all(toEmail.map((user) => sendGameNotificationEmail(user)));
		}),
		60000,
	);
}
