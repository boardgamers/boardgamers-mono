import { AssertionError } from "assert";
import { ZodError } from "zod";
import { flatten } from "@bgs/utils";
import type { Server } from "http";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
/* Koa stuff */
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import compression from "koa-compress";
import cookie from "koa-cookie";
import morgan from "koa-morgan";
import passport from "koa-passport";
import env from "./config/env";
/* Configure passport */
import "./config/passport";
import { ApiError } from "./models";
/* Local stuff */
import router from "./routes";
import { collections } from "./config/db";
import { differenceInMinutes } from "date-fns";
import type { User } from "@bgs/types";

async function listen(port = env.listen.port.api): Promise<Server> {
  const app = new Koa<Koa.DefaultState & { user?: User<ObjectId> | null }>();

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
        ctx.state.user = await collections.users.findOne({ _id: new ObjectId(decoded.userId) });
      }
    };

    if (ctx.get("Authorization")?.startsWith("Bearer ")) {
      const token = ctx.get("Authorization").slice("Bearer ".length);

      await processToken(token);
    } else if (ctx.query.token) {
      await processToken(ctx.query.token);
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
      // todo: handle zod errors
      if (err instanceof createError.HttpError) {
        ctx.status = err.statusCode;
        ctx.body = { message: err.message };
      } else if (err instanceof ZodError) {
        const formattedError = err.format();

        const message = Object.entries(flatten(formattedError) as Record<string, string[]>)
          .filter(
            (entry: [string, unknown]): entry is [string, string[]] =>
              !!(entry[0].endsWith("._errors") && Array.isArray(entry[1]) && entry[1].length)
          )
          .map(([key, val]) => `${key.slice(0, -"._errors".length)}: ${val[0]}`)
          .join(", ");

        ctx.status = 422;
        ctx.body = { message };
      } else if (err instanceof AssertionError) {
        ctx.status = 422;
        ctx.body = { message: err.message };
      } else {
        ctx.status = 500;
        ctx.body = { message: "Internal error: " + (err as Error).message, stack: (err as Error).stack };
      }

      try {
        if (ctx.request.body?.password) {
          ctx.request.body.password = "*******";
        }
        await ApiError.create({
          request: {
            url: ctx.request.originalUrl,
            method: ctx.request.method,
            body: JSON.stringify(ctx.request.body),
          },
          error: {
            name: (err as Error).name,
            stack: (err as Error).stack,
            message: (err as Error).message,
          },
          user: ctx.state.user?._id,
          meta: {
            source: "api-node",
          },
        });
        if (process.env.NODE_ENV !== "production" && !env.silent) {
          console.error(err);
        }
      } catch (_err) {
        if (!env.silent) {
          console.error(_err);
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
        await collections.users.updateOne(
          {
            _id: user._id,
          },
          {
            $set: {
              "security.lastLogin.date": Date.now(),
              "security.lastLogin.ip": ctx.ip,
              "security.lastIp": ctx.ip,
            },
          }
        );
      } else {
        if (user.security.lastIp !== ctx.ip || differenceInMinutes(Date.now(), user.security.lastActive) > 1) {
          await collections.users.updateOne(
            {
              _id: user._id,
            },
            {
              $set: {
                "security.lastActive": new Date(),
                "security.lastIp": ctx.ip,
                updatedAt: new Date(),
              },
            }
          );
        }
      }
    }
  });

  app.use(async (ctx, next) => {
    await next();

    if (ctx.state.user) {
      const user = ctx.state.user;

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
          { expiresIn: "1h", algorithm: env.jwt.algorithm }
        ),
        { httpOnly: true, sameSite: true, domain: env.domain }
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

  return server!;
}

export { listen };
