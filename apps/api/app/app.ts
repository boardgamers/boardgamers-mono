import { AssertionError } from "node:assert";
import type { Server } from "node:http";
import createError from "http-errors";
import { z, ZodError } from "zod";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
/* Koa stuff */
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import compression from "koa-compress";
import _cookie from "koa-cookie";
const cookie = (_cookie as { default?: typeof _cookie }).default ?? _cookie;
import morgan from "koa-morgan";
import passport from "koa-passport";
import env from "./config/env.ts";
/* Configure passport */
import "./config/passport.ts";
import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "./config/db.ts";
import { notifyLogin, notifyLastIp } from "./models/user.ts";
/* Local stuff */
import router from "./routes/index.ts";

async function listen(port = env.listen.port.api) {
  const app = new Koa<Koa.DefaultState & { user: WithId<UserDoc> }>();

  /* Configuration */
  app.keys = [env.sessionSecret];

  /* App stuff */
  if (!env.silent) {
    app.use(morgan("dev"));
  }
  app.proxy = true;
  app.use(compression());
  app.use(bodyParser());
  app.use(cookie());

  /* Required for passport */
  app.use(passport.initialize());

  // JWT auth
  app.use(async (ctx, next) => {
    const processToken = async (token: string) => {
      const decoded = jwt.verify(token, env.jwt.keys.public) as { userId: string; scopes: string[] };

      if (decoded && decoded.scopes.includes("all")) {
        ctx.state.user = await colls.users.findOne({ _id: new ObjectId(decoded.userId) });
      }
    };

    if (ctx.get("Authorization")?.startsWith("Bearer ")) {
      const token = ctx.get("Authorization").slice("Bearer ".length);

      await processToken(token);
    } else if (ctx.query.token) {
      await processToken(String(ctx.query.token));
    }

    await next();
  });

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (!env.silent) {
        console.error("Caught err", err);
      }
      if (err instanceof createError.HttpError) {
        ctx.status = err.statusCode;
        ctx.body = { message: err.message };
      } else if (err instanceof ZodError) {
        ctx.status = 400;
        ctx.body = { message: z.prettifyError(err) };
      } else if (err.name === "ValidationError") {
        const keys = Object.keys(err.errors);
        ctx.status = 422;
        ctx.body = { message: err.errors[keys[0]].message };
      } else if (err instanceof AssertionError) {
        ctx.status = 422;
        ctx.body = { message: err.message };
      } else {
        ctx.status = 500;
        ctx.body = { message: "Internal error: " + err.message, stack: err.stack };
      }

      try {
        const body = ctx.request.body as Record<string, unknown>;
        if (body?.password) {
          body.password = "*******";
        }
        await colls.apiErrors.insertOne({
          request: {
            url: ctx.request.originalUrl,
            method: ctx.request.method,
            body: JSON.stringify(ctx.request.body),
          },
          error: {
            name: err.name,
            stack: err.stack,
            message: err.message,
          },
          user: ctx.state.user?._id,
          meta: {
            source: "api-node",
          },
        });
        if (process.env.NODE_ENV !== "production" && !env.silent) {
          console.error(err);
        }
      } catch (err) {
        if (!env.silent) {
          console.error(err);
        }
      }
    }
  });

  app.use(async (ctx, next) => {
    const oldUser = ctx.state.user;

    await next();

    const user = ctx.state.user;

    if (user) {
      if (!oldUser) {
        await notifyLogin(user, ctx.ip);
      } else {
        await notifyLastIp(user, ctx.ip);
      }
    }
  });

  app.use(async (ctx, next) => {
    await next();

    if (ctx.state.user) {
      const user: WithId<UserDoc> = ctx.state.user;

      // Token for forum SSO
      ctx.cookies.set(
        "token",
        jwt.sign(
          {
            id: user._id.toString(),
            username: user.account.username,
            email: user.account.email,
          },
          env.jwt.keys.private,
          { expiresIn: "1h", algorithm: env.jwt.algorithm },
        ),
        { httpOnly: true, sameSite: true, domain: env.domain },
      );
    } else if (ctx.cookies.get("token")) {
      // Remove cookie if logged out
      ctx.cookies.set("token", null, { maxAge: 0 });
    }
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  let server: Server;

  await new Promise<void>((resolve, reject) => {
    console.log("listening...");
    server = app.listen(port, env.listen.host, resolve);
    app.once("error", (err) => reject(err));
  });

  console.log("app started on port", port, "and host", env.listen.host);

  return server;
}

export { listen };
