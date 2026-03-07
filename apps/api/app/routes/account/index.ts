import assert from "node:assert";
import createError from "http-errors";
import Jimp from "jimp";
import type { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import type { GamePreferencesDoc } from "@bgs/models";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { accessTokenDuration, createAccessToken, findGamesWithPlayersTurn, isUserAdmin } from "../../models/index.ts";
import {
  confirm,
  findByEmail,
  generateConfirmKey,
  generateResetLink,
  sendConfirmationEmail,
  sendMailChangeEmail,
  sendResetEmail,
  stripSensitiveFields,
} from "../../models/user.ts";
import type { ImageDoc } from "@bgs/models";
import { loggedIn, loggedOut } from "../utils.ts";
import auth from "./auth.ts";
import { sendAuthInfo } from "./utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.use("/auth", auth.routes(), auth.allowedMethods());

router.get("/", (ctx) => {
  if (ctx.state.user) {
    ctx.body = ctx.state.user;
  }
});

router.get("/avatar", loggedIn, async (ctx) => {
  const item = await colls.images.findOne(
    { ref: ctx.state.user._id, refType: "User", key: "avatar" },
    { projection: { "images.256x256": 1 } }
  );
  if (!item) {
    return;
  }

  const img = item.images["256x256"];
  ctx.set("Content-Type", img.mime);
  ctx.set("Cache-Control", "no-cache");
  ctx.body = img.raw;
});

router.get("/active-games", async (ctx) => {
  if (!ctx.state.user?._id) {
    ctx.body = [];
  } else {
    const games = await findGamesWithPlayersTurn(ctx.state.user._id).project({ _id: 1 }).toArray();
    ctx.body = games.map((game) => game._id);
  }
});

router.post("/", loggedIn, async (ctx) => {
  const body = z
    .object({
      settings: z.any().optional(),
      account: z
        .object({
          avatar: z.string().optional(),
          bio: z.string().optional(),
        })
        .optional(),
    })
    .parse(ctx.request.body);

  const avatar = body.account?.avatar;
  assert(!avatar?.includes("/") && !avatar?.includes("."), "Invalid avatar");

  const updateFields: Record<string, unknown> = {};
  if (body.settings != null) updateFields.settings = body.settings;
  if (body.account?.avatar != null) updateFields["account.avatar"] = body.account.avatar;
  if (body.account?.bio != null) updateFields["account.bio"] = body.account.bio;

  if (Object.keys(updateFields).length > 0) {
    await colls.users.updateOne({ _id: ctx.state.user._id }, { $set: updateFields });
  }

  const updatedUser = await colls.users.findOne({ _id: ctx.state.user._id });
  ctx.body = updatedUser;
});

router.post("/avatar", loggedIn, async (ctx) => {
  const parts = [];
  for await (const chunk of ctx.req) {
    parts.push(chunk);
  }

  const input = Buffer.concat(parts);
  const image = await Jimp.read(input);

  const mime: "image/jpeg" | "image/png" = [Jimp.MIME_JPEG, Jimp.MIME_PNG].includes(
    image.getMIME() as "image/jpeg" | "image/png"
  )
    ? (image.getMIME() as "image/jpeg" | "image/png")
    : image.hasAlpha
      ? Jimp.MIME_PNG
      : Jimp.MIME_JPEG;

  const imagesObj: ImageDoc["images"] = {};
  for (const size of [256, 128, 64]) {
    if (image.getWidth() > size || image.getHeight() > size) {
      image.cover(size, size);
    } else if (image.getWidth() !== image.getHeight()) {
      image.cover(Math.max(image.getWidth(), image.getHeight()), Math.max(image.getWidth(), image.getHeight()));
    }
    const converted = await image.quality(85).getBufferAsync(mime as "image/jpeg" | "image/png");
    imagesObj[`${size}x${size}`] = { mime, raw: converted, size: converted.length };
  }

  await colls.images.updateOne(
    { ref: ctx.state.user._id, key: "avatar", refType: "User" },
    {
      $set: {
        images: imagesObj,
        formats: Object.keys(imagesObj),
      },
    },
    { upsert: true }
  );
  await colls.users.updateOne({ _id: ctx.state.user._id }, { $set: { "account.avatar": "upload" } });

  ctx.status = 200;
});

router.post("/email", loggedIn, async (ctx) => {
  const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
  const user = ctx.state.user;

  const foundUser = await findByEmail(email);

  if (foundUser) {
    if (foundUser._id.equals(user._id)) {
      ctx.body = user;
      return;
    }

    throw createError(400, "Another user with that email address already exists");
  }

  await colls.logs.insertOne({
    kind: "mailChange",
    data: { player: user._id, change: { from: user.account.email, to: email } },
  });

  sendMailChangeEmail(user, email).catch(console.error);

  const confirmKey = generateConfirmKey();
  await colls.users.updateOne(
    { _id: user._id },
    {
      $set: {
        "account.email": email,
        "security.confirmed": false,
        "security.confirmKey": confirmKey,
      },
    }
  );

  const updatedUser = await colls.users.findOne({ _id: user._id });
  if (updatedUser) {
    await sendConfirmationEmail(updatedUser);
    ctx.body = stripSensitiveFields(updatedUser);
  }
});

router.post("/terms-and-conditions", loggedIn, async (ctx) => {
  assert(!ctx.state.user.account.termsAndConditions, "You already accepted the Terms and Conditions");
  await colls.users.updateOne({ _id: ctx.state.user._id }, { $set: { "account.termsAndConditions": new Date() } });
  const updatedUser = await colls.users.findOne({ _id: ctx.state.user._id });
  ctx.body = updatedUser;
});

router.get("/games/settings", loggedIn, async (ctx) => {
  ctx.body = await colls.gamePreferences.find({ user: ctx.state.user._id }).toArray();
});

router.get("/games/:game/settings", loggedIn, async (ctx) => {
  let pref = await colls.gamePreferences.findOne({ user: ctx.state.user._id, game: ctx.params.game });

  if (!pref) {
    const newPref = {
      user: ctx.state.user._id,
      game: ctx.params.game,
      access: { ownership: false } as const,
    };
    await colls.gamePreferences.insertOne(newPref as GamePreferencesDoc);
    pref = (await colls.gamePreferences.findOne({ user: ctx.state.user._id, game: ctx.params.game }))!;
  }

  // Unstringify stringified preferences
  if (pref.preferences) {
    for (const key in pref.preferences) {
      const val = pref.preferences[key] as { stringified?: boolean; value?: string } | undefined;
      if (val?.stringified) {
        pref.preferences[key] = val.value !== undefined ? JSON.parse(val.value) : undefined;
      }
    }
  }

  ctx.body = pref;
});

router.post("/games/:game/ownership", loggedIn, async (ctx) => {
  const { access } = z.object({ access: z.object({ ownership: z.boolean() }) }).parse(ctx.request.body);
  const count = await colls.gameInfos.countDocuments({ "_id.game": ctx.params.game });

  if (!count) {
    return;
  }

  await colls.gamePreferences.updateOne(
    {
      user: ctx.state.user._id,
      game: ctx.params.game,
    },
    {
      $set: {
        "access.ownership": access.ownership,
      },
    },
    {
      upsert: true,
    }
  );

  ctx.status = 200;
});

router.post("/games/:game/preferences/:version", loggedIn, async (ctx) => {
  const body = z
    .record(z.string(), z.unknown())
    .and(z.object({ alternateUI: z.boolean().optional() }))
    .parse(ctx.request.body);
  const gameInfo = await colls.gameInfos.findOne({ _id: { game: ctx.params.game, version: +ctx.params.version } });

  if (!gameInfo) {
    return;
  }

  const newPrefs: Record<string, boolean | string | { stringified: true; value: string }> = {};

  for (const pref of gameInfo.preferences) {
    const newVal = body[pref.name];
    if (pref.type === "checkbox") {
      newPrefs[pref.name] = !!newVal;
    } else if (pref.type === "select") {
      newPrefs[pref.name] = pref.items.some((it) => it.name === newVal) ? (newVal as string) : pref.items[0]?.name;
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
    newPrefs.alternateUI = !!body.alternateUI;
  }

  await colls.gamePreferences.updateOne(
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
  const body = z.object({ email: z.string().email(), key: z.string() }).parse(ctx.request.body);
  const user = await findByEmail(body.email);

  if (!user) {
    throw createError(404, "Can't find user: " + body.email);
  }

  if (user.security.confirmed) {
    ctx.redirect("/login");
    return;
  }

  await confirm(user, body.key);

  const updatedUser = await colls.users.findOne({ _id: user._id });
  ctx.state.user = updatedUser;

  await sendAuthInfo(ctx);
});

router.post("/refresh", async (ctx: Context) => {
  const { code, scopes } = z
    .object({ code: z.string(), scopes: z.array(z.string()).optional() })
    .parse(ctx.request.body);

  const rt = await colls.jwtRefreshTokens.findOne({ code });

  if (!rt) {
    throw createError(404, "Can't find refresh token: " + code);
  }

  const user = await colls.users.findOne({ _id: rt.user });
  if (!user) {
    throw createError(404, "User not found");
  }

  ctx.body = {
    code: await createAccessToken(rt, scopes, isUserAdmin(user)),
    expiresAt: Date.now() + accessTokenDuration(),
  };
});

router.post("/reset", loggedOut, passport.authenticate("local-reset", { session: false }), sendAuthInfo);

router.post("/forget", loggedOut, async (ctx: Context) => {
  const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
  const user = await findByEmail(email);

  if (!user) {
    throw createError(404, "Utilisateur introuvable: " + email);
  }

  await generateResetLink(user);
  await sendResetEmail(user);
  ctx.status = 200;
});

export { sendAuthInfo };
export default router;
