import { Context } from "koa";
import checkDiskSpace from "check-disk-space";
import createError from "http-errors";
import Router from "koa-router";
import { isAdmin } from "../utils";
import validator from "validator";
import assert from "assert";
import { SettingsKey } from "../../models/settings";
import { sendAuthInfo } from "../account";
import gameInfo from "./gameinfo";
import page from "./pages";
import users from "./users";
import { env } from "../../config";
import User from "../../models/user";
import Settings from "../../models/settings";
import Game from "../../models/game";
import GameNotification from "../../models/gamenotification";
import Log from "../../models/log";

const router = new Router<Application.DefaultState, Context>();

router.use(isAdmin);

router.use("/gameinfo", gameInfo.routes(), gameInfo.allowedMethods());
router.use("/page", page.routes(), page.allowedMethods());
router.use("/users", users.routes(), users.allowedMethods());

router.get("/serverinfo", async (ctx) => {
  ctx.body = {
    disk: await checkDiskSpace(process.cwd()),
    nbUsers: await User.count({}),
    announcement: (await Settings.findById(SettingsKey.Announcement))?.value,
    chron: env.chron,
  };
});

router.post("/resend-confirmation", async (ctx) => {
  const { email } = ctx.request.body;
  const user = await User.findByEmail(email);

  if (!user) {
    throw createError(404, "User not found: " + email);
  }

  await user.sendConfirmationEmail();
  ctx.status = 200;
});

router.post("/login-as", async (ctx) => {
  const { username } = ctx.request.body;
  const user = await User.findByUsername(username);

  if (!user) {
    throw createError(404, "User not found: " + username);
  }

  ctx.state.user = user;

  await sendAuthInfo(ctx);
});

router.post("/compute-karma", async (ctx) => {
  const { username } = ctx.request.body;
  const user = await User.findByUsername(username);

  if (!user) {
    throw createError(404, "User not found: " + username);
  }

  await user.recalculateKarma();
  await user.save();

  ctx.status = 200;
});

router.post("/compute-all-karma", async (ctx) => {
  for (const user of await User.find()) {
    await user.recalculateKarma(new Date("2020-05-10"));
    await user.save();
  }

  ctx.status = 200;
});

router.post("/announcement", async (ctx) => {
  await Settings.updateOne(
    { _id: SettingsKey.Announcement },
    { $set: { value: ctx.request.body?.announcement } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.post("/recreate-notifications", async (ctx) => {
  const notifications = await Game.aggregate([
    {
      $match: {
        status: "ended",
        updatedAt: {
          $gt: new Date(Date.now() - 24 * 3600 * 1000 * 10),
        },
      },
    },
    { $project: { _id: 1 } },
    {
      $lookup: {
        from: Log.collection.name,
        localField: "_id",
        foreignField: "data.game",
        as: "log",
      },
    },
    {
      $match: {
        log: {
          $not: {
            $elemMatch: {
              kind: "processGameEnded",
            },
          },
        },
      },
    },
    {
      $lookup: {
        from: GameNotification.collection.name,
        localField: "_id",
        foreignField: "game",
        as: "notification",
      },
    },
    {
      $match: {
        game: {
          $not: {
            $elemMatch: {
              kind: "gameEnded",
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        game: "$_id",
        kind: "gameEnded",
      },
    },
  ]);

  await GameNotification.insertMany(notifications);
  ctx.status = 200;
  ctx.body = notifications;
});

export default router;
