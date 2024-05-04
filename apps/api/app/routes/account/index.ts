import assert from "assert";
import createError from "http-errors";
import Jimp from "jimp";
import type { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import { merge } from "lodash";
import { ObjectId } from "mongodb";
import type { Image } from "../../models";
import {
  GamePreferences,
  GameUtils,
  ImageCollection,
  JwtRefreshToken,
  Log,
  MAX_BIO_LENGTH,
  UserUtils,
} from "../../models";
import { loggedIn, loggedOut } from "../utils";
import auth from "./auth";
import { sendAuthInfo } from "./utils";
import { z } from "zod";
import type { Game, User } from "@bgs/types";
import { AVATAR_STYLES } from "@bgs/types";
import { collections } from "../../config/db";
import { typedInclude } from "@bgs/utils";
import { env, sendmail } from "../../config";
import { differenceInMinutes } from "date-fns";

const router = new Router<Application.DefaultState, Context>();

router.use("/auth", auth.routes(), auth.allowedMethods());

router.get("/", (ctx) => {
  if (ctx.state.user) {
    ctx.body = UserUtils.sanitize(ctx.state.user);
  }
});

router.get("/avatar", loggedIn, async (ctx) => {
  const item = await ImageCollection.findOne(
    { ref: ctx.state.user!._id, refType: "User", key: "avatar" },
    { "images.256x256": 1, mime: 1 }
  );
  if (!item) {
    return;
  }

  ctx.set("Content-Type", item.images.get("256x256").mime);
  ctx.set("Cache-Control", "no-cache");
  ctx.body = item.images.get("256x256").raw;
});

router.get("/active-games", async (ctx) => {
  if (!ctx.state.user?._id) {
    ctx.body = [];
  } else {
    ctx.body = await GameUtils.findWithPlayersTurn(ctx.state.user._id)
      .project<Pick<Game<ObjectId>, "_id">>({ _id: 1 })
      .map((game) => game._id)
      .toArray();
  }
});

router.post("/", loggedIn, async (ctx) => {
  const body = ctx.request.body;
  const user = ctx.state.user!;

  const parsed = z
    .object({
      account: z
        .object({
          avatar: z.enum([AVATAR_STYLES[0], ...AVATAR_STYLES.slice(1)]).optional(),
          bio: z.string().trim().max(MAX_BIO_LENGTH).optional(),
        })
        .optional(),
      settings: z.object({
        mailing: z
          .object({
            newsletter: z.boolean().optional(),
            game: z.object({
              /** Delay before sending a mail notification, in seconds */
              delay: z.number().int().min(0).optional(),
              /** Are email notifications enabled? */
              activated: z.boolean().optional(),
            }),
          })
          .optional(),
        game: z.object({
          soundNotification: z.boolean().optional(),
        }),
        home: z.object({
          /** Show my games instead of featured games */
          showMyGames: z.boolean().optional(),
        }),
      }),
    })
    .parse(body);

  merge(user, parsed);

  const updatedUser = await collections.users.findOneAndUpdate(
    { _id: user._id },
    {
      $set: {
        "account.bio": user.account.bio,
        "account.avatar": user.account.avatar,
        settings: user.settings,
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!updatedUser) {
    throw createError(404, "User not found");
  }

  ctx.body = UserUtils.sanitize(updatedUser);
});

router.post("/avatar", loggedIn, async (ctx) => {
  const parts = [];
  for await (const chunk of ctx.req) {
    parts.push(chunk);
  }

  const input = Buffer.concat(parts);
  const image = await Jimp.read(input);

  const mime = typedInclude([Jimp.MIME_JPEG, Jimp.MIME_PNG], image.getMIME())
    ? image.getMIME()
    : image.hasAlpha()
      ? Jimp.MIME_PNG
      : Jimp.MIME_JPEG;

  const images: Image["images"] = new Map();
  for (const size of [256, 128, 64]) {
    if (image.getWidth() > size || image.getHeight() > size) {
      image.cover(size, size);
    } else if (image.getWidth() !== image.getHeight()) {
      image.cover(Math.max(image.getWidth(), image.getHeight()), Math.max(image.getWidth(), image.getHeight()));
    }
    const converted = await image.quality(85).getBufferAsync(mime);
    images.set(`${size}x${size}`, { mime, raw: converted, size: converted.length });
  }

  await ImageCollection.updateOne(
    { ref: ctx.state.user!._id, key: "avatar", refType: "User" },
    {
      $set: {
        images,
        formats: [...images.keys()],
      },
    },
    { upsert: true }
  );

  await collections.users.updateOne(
    {
      _id: ctx.state.user!._id,
    },
    {
      $set: {
        "account.avatar": "upload",
        updatedAt: new Date(),
      },
    }
  );

  ctx.status = 200;
});

router.post("/email", loggedIn, async (ctx) => {
  const { email } = ctx.request.body;
  const user = ctx.state.user!;

  const foundUser = await UserUtils.findByEmail(email);

  if (foundUser) {
    if (foundUser._id.equals(user._id)) {
      ctx.body = UserUtils.sanitize(user);
      return;
    }

    throw createError(400, "Another user with that email address already exists");
  }

  await Log.create({ kind: "mailChange", data: { player: user._id, change: { from: user.account.email, to: email } } });

  user.sendMailChangeEmail(email).catch(console.error);

  user.account.email = email;
  user.security.confirmed = false;
  user.generateConfirmKey();
  await user.save();

  await user.sendConfirmationEmail();

  ctx.body = UserUtils.sanitize(user);
});

router.post("/terms-and-conditions", loggedIn, async (ctx) => {
  assert(!ctx.state.user!.account.termsAndConditions, "You already accepted the Terms and Conditions");

  const updatedUser = await collections.users.findOneAndUpdate(
    {
      _id: ctx.state.user!._id,
    },
    {
      $set: {
        "account.termsAndConditions": new Date(),
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!updatedUser) {
    throw createError(404, "User not found");
  }

  ctx.body = UserUtils.sanitize(updatedUser);
});

router.get("/games/settings", loggedIn, async (ctx) => {
  ctx.body = await GamePreferences.find({ user: ctx.state.user._id }).lean(true);
});

router.get("/games/:game/settings", loggedIn, async (ctx) => {
  let pref = await GamePreferences.findOne({ user: ctx.state.user._id, game: ctx.params.game }).lean(true);

  if (!pref) {
    pref = await GamePreferences.create({ user: ctx.state.user._id, game: ctx.params.game });
  }

  // Unstringify stringified preferences
  if (pref.preferences) {
    for (const key in pref.preferences) {
      if (pref.preferences[key]?.stringified) {
        pref.preferences[key] =
          pref.preferences[key].value !== undefined ? JSON.parse(pref.preferences[key].value) : undefined;
      }
    }
  }

  ctx.body = pref;
});

router.post("/games/:game/ownership", loggedIn, async (ctx) => {
  const gameInfo = await GameInfo.count({ "_id.game": ctx.params.game }).limit(1);

  if (!gameInfo) {
    return;
  }

  await GamePreferences.updateOne(
    {
      user: ctx.state.user._id,
      game: ctx.params.game,
    },
    {
      $set: {
        "access.ownership": ctx.request.body.access.ownership,
      },
    },
    {
      upsert: true,
    }
  );

  ctx.status = 200;
});

router.post("/games/:game/preferences/:version", loggedIn, async (ctx) => {
  const gameInfo = await GameInfo.findById({ game: ctx.params.game, version: +ctx.params.version });

  if (!gameInfo) {
    return;
  }

  const newPrefs: Record<string, boolean | string | { stringified: true; value: string }> = {};

  for (const pref of gameInfo.preferences) {
    const newVal = ctx.request.body[pref.name];
    if (pref.type === "checkbox") {
      newPrefs[pref.name] = !!newVal;
    } else if (pref.type === "select") {
      newPrefs[pref.name] = pref.items.some((it) => it.name === newVal) ? newVal : pref.items[0]?.name;
    } else if (pref.type === "hidden") {
      newPrefs[pref.name] = {
        value: JSON.stringify(newVal),
        stringified: true,
      };
    } else {
      // not handled
    }
  }

  if (gameInfo.viewer?.alternate?.url) {
    newPrefs.alternateUI = !!ctx.request.body.alternateUI;
  }

  await GamePreferences.updateOne(
    {
      user: ctx.state.user._id,
      game: ctx.params.game,
    },
    {
      $set: {
        preferences: newPrefs,
      },
    },
    {
      upsert: true,
    }
  );

  ctx.status = 200;
});

router.post("/signup", loggedOut, passport.authenticate("local-signup", { session: false }), sendAuthInfo);

router.post("/signup/social", loggedOut, passport.authenticate("social-signup", { session: false }), sendAuthInfo);

router.post("/login", passport.authenticate("local-login", { session: false }), sendAuthInfo);

router.post("/signout", (ctx: Context) => {
  ctx.logout();
  ctx.status = 200;
});

router.post("/confirm", async (ctx: Context) => {
  const user = await UserUtils.findByEmail(ctx.request.body.email);

  if (!user) {
    throw createError(404, "Can't find user: " + ctx.request.body.email);
  }

  const passedKey = z.object({ key: z.string() }).parse(ctx.request.body).key;

  if (user.security.confirmed) {
    throw createError(400, "User already confirmed.");
  }

  assert(passedKey === user.security.confirmKey, `Wrong confirm link.`);

  const updatedUser = await collections.users.findOneAndUpdate(
    {
      _id: user._id,
    },
    {
      $set: {
        "security.confirmed": true,
        "security.confirmKey": null,
        updatedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!updatedUser) {
    throw createError(404, "User not found");
  }

  ctx.state.user = updatedUser;
  await sendAuthInfo(ctx);
});

router.post("/refresh", async (ctx: Context) => {
  const { code, scopes } = ctx.request.body;

  const rt = await JwtRefreshToken.findOne({ code });

  if (!rt) {
    throw createError(404, "Can't find refresh token: " + code);
  }

  const user = await collections.users.findOne<Pick<User<ObjectId>, "authority">>(
    { _id: new ObjectId(rt.user) },
    { projection: { authority: 1 } }
  );

  if (!user) {
    throw createError(404, "Can't find user: " + rt.user);
  }

  ctx.body = {
    code: await rt.createAccessToken(scopes, UserUtils.isAdmin(user.authority)),
    expiresAt: Date.now() + JwtRefreshToken.accessTokenDuration(),
  };
});

router.post("/reset", loggedOut, passport.authenticate("local-reset", { session: false }), sendAuthInfo);

router.post("/forget", loggedOut, async (ctx: Context) => {
  const { email } = ctx.request.body;
  const user = await UserUtils.findByEmail(email);

  if (!user) {
    throw createError(404, "User not found: " + email);
  }

  if (user.security.reset && differenceInMinutes(new Date(), user.security.reset.issued) < 15) {
    throw createError(400, "You can only request a password reset every 5 minutes");
  }

  user.security.reset = {
    key: UserUtils.generateConfirmKey(),
    issued: new Date(),
  };

  await collections.users.updateOne(
    {
      _id: user._id,
    },
    {
      $set: {
        "security.reset": user.security.reset,
        updatedAt: new Date(),
      },
    }
  );

  await sendmail({
    from: env.noreply,
    to: email,
    subject: "Forgotten password",
    html: `
    <p>A password reset was asked for your account,
    click <a href='http://${env.site}/reset?key=${encodeURIComponent(
      user.security.reset.key
    )}&email=${encodeURIComponent(email)}'>here</a> to reset your password.</p>

    <p>If this didn't come from you, ignore this email.</p>`,
  });
  ctx.status = 200;
});

export { sendAuthInfo };
export default router;
