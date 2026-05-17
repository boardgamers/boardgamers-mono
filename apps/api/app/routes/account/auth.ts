import jwt from "jsonwebtoken";
import type { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import { z } from "zod";
import { env } from "../../config/index.ts";
import { sendAuthInfo } from "./utils.ts";

const router = new Router<Application.DefaultState, Context>();

const socialFeedbackSchema = z.object({
  createSocialAccount: z.boolean(),
  provider: z.string(),
  id: z.string(),
});

router.get("/google", async (ctx, next) => {
  await passport.authenticate("google", {
    scope: ["openid"],
    callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/google/callback`,
  })(ctx, next);
});

router.get("/discord", async (ctx, next) => {
  await passport.authenticate("discord", {
    scope: ["identify"],
    callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/discord/callback`,
  })(ctx, next);
});

router.get("/facebook", async (ctx, next) => {
  await passport.authenticate("facebook", {
    scope: [],
    callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/facebook/callback`,
  })(ctx, next);
});

router.get(
  "/:provider/callback",
  async (ctx, next) => {
    await passport.authenticate(ctx.params.provider, {
      failureRedirect: "/",
      callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/${ctx.params.provider}/callback`,
      session: false,
    })(ctx, next);
  },
  async (ctx) => {
    const feedback = socialFeedbackSchema.safeParse(ctx.state.user);
    if (feedback.success && feedback.data.createSocialAccount) {
      const { provider, id } = feedback.data;

      ctx.state.user = undefined;

      const body = {
        createSocialAccount: true,
        provider,
        id,
      };

      ctx.body = {
        ...body,
        jwt: jwt.sign(body, env.jwt.keys.private, { expiresIn: "1h", algorithm: env.jwt.algorithm }),
      };
    } else {
      await sendAuthInfo(ctx);
    }
  },
);

export default router;
