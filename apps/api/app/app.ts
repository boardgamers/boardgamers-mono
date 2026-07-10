import { AssertionError } from "node:assert";
import { randomUUID } from "node:crypto";
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
// Handle both CJS default-as-namespace and ESM-default imports of koa-cookie.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const cookie = (_cookie as unknown as { default?: typeof _cookie }).default ?? _cookie;
import morgan from "koa-morgan";
import passport from "koa-passport";
import { logRequest, matchedRoute } from "@bgs/utils/log";
import env from "./config/env.ts";
/* Configure passport */
import "./config/passport.ts";
import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "./config/db.ts";
import { accessTokenPayloadSchema } from "./models/jwtrefreshtokens.ts";
import { notifyLogin, notifyLastIp } from "./models/user.ts";
/* Local stuff */
import router from "./routes/index.ts";

async function listen(port = env.listen.port.api) {
  const app = new Koa<Application.DefaultState>();

  /* Configuration */
  app.keys = [env.sessionSecret];

  /* App stuff */
  if (!env.silent) {
    app.use(morgan("dev"));
  }
  // Assign a short request ID so logs, DB error records, and the client-facing
  // response header all share a single correlation key. Use the incoming
  // X-Request-ID if provided (e.g. from nginx), otherwise generate one.
  app.use(async (ctx, next) => {
    ctx.state.requestId = ctx.get("x-request-id") || randomUUID();
    await next();
    ctx.set("x-request-id", ctx.state.requestId);
  });

  // Structured JSON request log (one line per request, including silent 4xx).
  app.use(async (ctx, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      const user = ctx.state.user as { _id?: { toString(): string } } | undefined;
      logRequest("api", {
        method: ctx.request.method,
        path: ctx.request.path,
        route: matchedRoute(ctx),
        status: ctx.status,
        durationMs: Date.now() - start,
        ip: ctx.ip,
        userId: user?._id?.toString(),
        requestId: ctx.state.requestId,
      });
    }
  });
  app.proxy = true;
  app.use(compression());
  app.use(bodyParser());
  app.use(cookie());

  /* Required for passport */
  app.use(passport.initialize());

  // JWT auth
  const tokenQuerySchema = z.object({ token: z.string().optional() });
  app.use(async (ctx, next) => {
    const processToken = async (token: string) => {
      try {
        const decoded = accessTokenPayloadSchema.parse(jwt.verify(token, env.jwt.keys.public));

        if (decoded.scopes.includes("all")) {
          ctx.state.user = (await colls.users.findOne({ _id: new ObjectId(decoded.userId) })) ?? undefined;
        }
      } catch {
        // Invalid/expired token — treat as unauthenticated, not a server error.
        // jwt.verify throws JsonWebTokenError ("invalid signature", "jwt expired",
        // "jwt malformed"); Zod throws on unexpected payload shape. Either way the
        // caller just gets no user and downstream auth middleware returns 401.
      }
    };

    if (ctx.get("Authorization")?.startsWith("Bearer ")) {
      const token = ctx.get("Authorization").slice("Bearer ".length);

      await processToken(token);
    } else {
      const { token } = tokenQuerySchema.parse(ctx.query);
      if (token) {
        await processToken(token);
      }
    }

    await next();
  });

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (err instanceof createError.HttpError) {
        ctx.status = err.statusCode;
        ctx.body = { message: err.message };
      } else if (err instanceof ZodError) {
        ctx.status = 400;
        ctx.body = { message: z.prettifyError(err) };
      } else if (err instanceof AssertionError) {
        ctx.status = 422;
        ctx.body = { message: err.message };
      } else {
        ctx.status = 500;
        ctx.body = { message: "Internal error: " + error.message, stack: error.stack };
      }

      // Routine 401 auth checks are expected traffic, not real errors — skip
      // the console dump and DB error record for them.
      const isRoutineAuth = err instanceof createError.HttpError && err.statusCode === 401;
      if (!isRoutineAuth) {
        if (!env.silent) {
          console.error("Caught err", err);
        }
        try {
          const body: unknown = ctx.request.body;
          if (body && typeof body === "object" && "password" in body && body.password) {
            // Redact the password before logging the request body.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            (body as Record<string, unknown>).password = "*******";
          }
          await colls.apiErrors.insertOne({
            request: {
              url: ctx.request.originalUrl,
              method: ctx.request.method,
              body: JSON.stringify(ctx.request.body),
              status: ctx.status,
              id: ctx.state.requestId,
            },
            error: {
              name: error.name,
              stack: error.stack ? error.stack.split("\n") : [],
              message: error.message,
            },
            user: ctx.state.user?._id,
            meta: {
              source: "api-node",
            },
          });
          if (process.env.NODE_ENV !== "production" && !env.silent) {
            console.error(err);
          }
        } catch (innerErr) {
          if (!env.silent) {
            console.error(innerErr);
          }
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
        { httpOnly: true, sameSite: true, domain: env.isProduction ? env.domain : undefined },
      );
    } else if (ctx.cookies.get("token")) {
      // Remove cookie if logged out
      ctx.cookies.set("token", null, { maxAge: 0 });
    }
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  let server!: Server;

  await new Promise<void>((resolve, reject) => {
    console.log("listening...");
    server = app.listen(port, env.listen.host, resolve);
    app.once("error", (err) => reject(err));
  });

  const addr = server.address();
  const actualPort = addr && typeof addr === "object" ? addr.port : port;
  console.log("app started on port", actualPort, "and host", env.listen.host);

  return server;
}

export { listen };
