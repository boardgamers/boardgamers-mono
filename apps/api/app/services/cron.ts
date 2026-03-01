import env from "../config/env.ts";
import {
  processCurrentMove,
  processGameEnded,
  processPlayerDrop,
} from "../models/gamenotification.ts";
import { sendGameNotificationEmail } from "../models/user.ts";
import { colls } from "../config/db.ts";
import { cancelOldOpenGames, processSchedulesGames, processUnreadyGames } from "./game.ts";

/* Check move deadlines every 10 seconds - only on one thread of the server */
if (env.cron) {
  setInterval(() => processCurrentMove().catch(console.error), 10000);
  setInterval(() => processGameEnded().catch(console.error), 10000);
  setInterval(() => processPlayerDrop().catch(console.error), 10000);
  setInterval(() => processSchedulesGames().catch(console.error), 1000);
  setInterval(() => cancelOldOpenGames().catch(console.error), 5000);
  setInterval(() => processUnreadyGames().catch(console.error), 10000);
}

if (env.automatedEmails) {
  setInterval(async () => {
    try {
      const toEmail = await colls.users
        .find({ "meta.nextGameNotification": { $lte: new Date() } })
        .toArray();

      for (const user of toEmail) {
        sendGameNotificationEmail(user).catch((err) => console.error(err));
      }
    } catch (err) {
      console.error(err);
    }
  }, 60000);
}
