import { collections } from "../config/db";
import env from "../config/env";
import { GameNotificationUtils } from "../models/gamenotification";
import { UserUtils } from "../models/user";
import { cancelOldOpenGames, processSchedulesGames, processUnreadyGames } from "./game";

/* Check move deadlines every 10 seconds - only on one thread of the server */
if (env.cron) {
  setInterval(() => GameNotificationUtils.processCurrentMove().catch(console.error), 10000);
  setInterval(() => GameNotificationUtils.processGameEnded().catch(console.error), 10000);
  setInterval(() => GameNotificationUtils.processPlayerDrop().catch(console.error), 10000);
  setInterval(() => processSchedulesGames().catch(console.error), 1000);
  setInterval(() => cancelOldOpenGames().catch(console.error), 5000);
  setInterval(() => processUnreadyGames().catch(console.error), 10000);
}

if (env.automatedEmails) {
  setInterval(async () => {
    try {
      const toEmail = await collections.users.find({ "meta.nextGameNotification": { $lte: new Date() } }).toArray();

      for (const user of toEmail) {
        UserUtils.sendGameNotificationEmail(user).catch((err: any) => console.error(err));
      }
    } catch (err) {
      console.error(err);
    }
  }, 60000);
}
