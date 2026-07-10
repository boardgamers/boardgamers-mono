/* Koa stuff */
import { AssertionError } from "node:assert";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { z, ZodError } from "zod";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import compression from "koa-compress";
import morgan from "koa-morgan";
import { logRequest } from "@bgs/utils/log";
import { colls } from "./config/db.ts";
/* Configure passport */
import env from "./config/env.ts";
/* Local stuff */
import router from "./routes/index.ts";

const app = new Koa<Koa.DefaultState & { user: { id: string; isAdmin: boolean } }>();

/* App stuff */
app.use(morgan("dev"));
app.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    logRequest("game-server", {
      method: ctx.request.method,
      path: ctx.request.path,
      status: ctx.status,
      durationMs: Date.now() - start,
      ip: ctx.ip,
      userId: ctx.state.user?.id,
    });
  }
});
app.proxy = true;
app.use(compression());
app.use(bodyParser());

// JWT auth
app.use(async (ctx, next) => {
  if (ctx.get("Authorization")?.startsWith("Bearer ")) {
    const token = ctx.get("Authorization").slice("Bearer ".length);

    const decoded = jwt.verify(token, env.jwt.keys.public) as { userId: string; isAdmin: boolean; scopes: string[] };

    if (decoded && decoded.scopes?.includes("gameplay")) {
      ctx.state.user = {
        id: decoded.userId,
        isAdmin: decoded.isAdmin,
      };
    }
  } else {
    console.log("no token");
  }

  await next();
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(err);
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
      ctx.body = { message: "Internal error: " + err.message, stack: err.stack };
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
      user: ctx.state.user?.id ? new ObjectId(ctx.state.user.id) : undefined,
      meta: {
        source: "game-server",
      },
      createdAt: new Date(),
    });
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

async function listen() {
  const promise = new Promise<void>((resolve, reject) => {
    app.listen(env.listen.port, env.listen.host, () => resolve());
    app.once("error", (err) => reject(err));
  });

  await promise;

  console.log("app started on port", env.listen.port);
}

listen().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});
