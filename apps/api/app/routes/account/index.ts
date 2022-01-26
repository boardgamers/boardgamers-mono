import assert from "assert";
import createError from "http-errors";
import Jimp from "jimp";
import { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import { merge, pick } from "lodash";
import {
  Game,
  GameInfo,
  GamePreferences,
  ImageCollection,
  JwtRefreshToken,
  Log,
  User,
  UserDocument,
} from "../../models";
import { loggedIn, loggedOut } from "../utils";
import auth from "./auth";
import { sendAuthInfo } from "./utils";

const router = new Router<Application.DefaultState, Context>();

router.use("/auth", auth.routes(), auth.allowedMethods());

router.get("/", (ctx) => {
  if (ctx.state.user) {
    ctx.body = ctx.state.user;
  }
});

router.get("/avatar", loggedIn, async (ctx) => {
  const item = await ImageCollection.findOne({ ref: ctx.state.user._id, refType: "User", key: "avatar" });
  if (!item) {
    return;
  }

  ctx.set("Content-Type", item.mime);
  ctx.set("Cache-Control", "no-cache");
  ctx.body = item.data;
});

router.get("/active-games", async (ctx) => {
  if (!ctx.state.user?._id) {
    ctx.body = [];
  } else {
    ctx.body = await Game.findWithPlayersTurn(ctx.state.user._id)
      .select("_id")
      .lean(true)
      .then((games) => games.map((game) => game._id));
  }
});

router.post("/", loggedIn, async (ctx) => {
  const body = ctx.request.body;

  // We only allow setting URLs through social media
  const avatar: string = body.account?.avatar;
  assert(!avatar?.includes("/") && !avatar?.includes("."), "Invalid avatar");

  merge(ctx.state.user, pick(body, ["settings", "account.avatar", "account.bio"]));
  await ctx.state.user.save();
  ctx.body = ctx.state.user;
});

router.post("/avatar", loggedIn, async (ctx) => {
  let parts = [];
  for await (const chunk of ctx.req) {
    parts.push(chunk);
  }

  const input = Buffer.concat(parts);
  const image = await Jimp.read(input);

  if (image.getWidth() > 256 || image.getHeight() > 256) {
    image.cover(256, 256);
  } else if (image.getWidth() !== image.getHeight()) {
    image.cover(Math.max(image.getWidth(), image.getHeight()), Math.max(image.getWidth(), image.getHeight()));
  }

  let converted = await image.getBufferAsync(Jimp.MIME_PNG);
  let mime: string = Jimp.MIME_PNG;

  if (converted.length > 40_000) {
    const jpeg = await image.quality(85).getBufferAsync(Jimp.MIME_JPEG);
    if (jpeg.length < converted.length) {
      mime = Jimp.MIME_JPEG;
      converted = jpeg;
    }
  }

  await ImageCollection.updateOne(
    { ref: ctx.state.user._id, key: "avatar", refType: "User" },
    {
      $set: {
        mime,
        width: image.getWidth(),
        height: image.getHeight(),
        size: converted.length,
        data: converted,
      },
    },
    { upsert: true }
  );
  ctx.state.user.account.avatar = "upload";
  await ctx.state.user.save();

  ctx.set("Content-Type", mime);
  ctx.body = converted;
});

router.post("/email", loggedIn, async (ctx) => {
  const { email } = ctx.request.body;
  const user: UserDocument = ctx.state.user;

  const foundUser = await User.findByEmail(email);

  if (foundUser) {
    if (foundUser._id.equals(user._id)) {
      ctx.body = user;
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

  ctx.body = user;
});

router.post("/terms-and-conditions", loggedIn, async (ctx) => {
  assert(!ctx.state.user.account.termsAndConditions, "You already accepted the Terms and Conditions");
  ctx.state.user.account.termsAndConditions = new Date();
  await ctx.state.user.save();
  ctx.body = ctx.state.user;
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
  const user = await User.findByEmail(ctx.request.body.email);

  if (!user) {
    throw createError(404, "Can't find user: " + ctx.request.body.email);
  }

  await user.confirm(ctx.request.body.key);

  await sendAuthInfo(ctx);
});

router.post("/refresh", async (ctx: Context) => {
  const { code, scopes } = ctx.request.body;

  const rt = await JwtRefreshToken.findOne({ code });

  if (!rt) {
    throw createError(404, "Can't find refresh token: " + code);
  }

  const user = await User.findById(rt.user);

  ctx.body = {
    code: await rt.createAccessToken(scopes, user.isAdmin()),
    expiresAt: Date.now() + JwtRefreshToken.accessTokenDuration(),
  };
});

router.post("/reset", loggedOut, passport.authenticate("local-reset", { session: false }), sendAuthInfo);

router.post("/forget", loggedOut, async (ctx: Context) => {
  const { email } = ctx.request.body;
  const user = await User.findByEmail(email);

  if (!user) {
    throw createError(404, "Utilisateur introuvable: " + email);
  }

  await user.generateResetLink();
  await user.sendResetEmail();
  ctx.status = 200;
});

export { sendAuthInfo };
export default router;
