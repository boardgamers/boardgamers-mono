import env from "../config/env";
import User from "../models/user";
import GameNotification from "../models/gamenotification";
import GameService from "./game";

/* Check move deadlines every 10 seconds - only on one thread of the server */
if (env.cron) {
  setInterval(() => GameNotification.processCurrentMove().catch(console.error), 10000);
  setInterval(() => GameNotification.processGameEnded().catch(console.error), 10000);
  setInterval(() => GameNotification.processPlayerDrop().catch(console.error), 10000);
  setInterval(() => GameService.processSchedulesGames().catch(console.error), 1000);
}

if (env.automatedEmails) {
  setInterval(async () => {
    try {
      const toEmail = await User.find({ "meta.nextGameNotification": { $lte: new Date() } });

      for (const user of toEmail) {
        user.sendGameNotificationEmail().catch((err) => console.error(err));
      }
    } catch (err) {
      console.error(err);
    }
  }, 60000);
}
