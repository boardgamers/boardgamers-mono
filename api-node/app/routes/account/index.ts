import assert from "assert";
import createError from "http-errors";
import { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import { fromPairs, merge, pick } from "lodash";
import GameInfo from "../../models/gameinfo";
import GamePreferences from "../../models/gamepreferences";
import JwtRefreshToken from "../../models/jwtrefreshtokens";
import Log from "../../models/log";
import User, { UserDocument } from "../../models/user";
import { loggedIn, loggedOut } from "../utils";
import auth from "./auth";
import { sendAuthInfo } from "./utils";

const router = new Router<Application.DefaultState, Context>();

router.use("/auth", auth.routes(), auth.allowedMethods());

router.get("/", (ctx) => {
  ctx.body = ctx.state.user;
});

router.post("/", loggedIn, async (ctx) => {
  merge(ctx.state.user, pick(ctx.request.body, ["settings"]));
  await ctx.state.user.save();
  ctx.body = ctx.state.user;
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

  user.sendMailChangeEmail(email);

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

  await GamePreferences.updateOne(
    {
      user: ctx.state.user._id,
      game: ctx.params.game,
    },
    {
      $set: {
        preferences: fromPairs(
          [...gameInfo.preferences, gameInfo.viewer?.alternate?.url ? { name: "alternateUI" } : null]
            .filter((x) => !!x)
            .map((pref) => [pref.name, !!ctx.request.body[pref.name]])
        ),
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

router.post("/login", loggedOut, passport.authenticate("local-login", { session: false }), sendAuthInfo);

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
  await ctx.logIn(user);

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
