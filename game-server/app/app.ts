/* Koa stuff */
import { AssertionError } from "assert";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import compression from "koa-compress";
import morgan from "koa-morgan";
import "./config/db";
/* Configure passport */
import env from "./config/env";
import ApiError from "./models/apierror";
/* Local stuff */
import router from "./routes";

const app = new Koa<Koa.DefaultState & { user: { id: string; isAdmin: boolean } }>();

/* App stuff */
app.use(morgan("dev"));
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
    } else if (err.name === "ValidationError") {
      const keys = Object.keys(err.errors);
      ctx.status = 422;
      ctx.body = { message: err.errors[keys[0]].message };
    } else if (err instanceof AssertionError) {
      ctx.status = 422;
      ctx.body = { message: err.message };
    } else {
      ctx.status = 500;
      ctx.body = { message: "Internal error" };
    }

    await ApiError.create({
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
      user: ctx.state.user?.id,
      meta: {
        source: "game-server",
      },
    });
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

async function listen() {
  try {
    const promise = new Promise<void>((resolve, reject) => {
      app.listen(env.listen.port, env.listen.host, () => resolve());
      app.once("error", (err) => reject(err));
    });

    await promise;

    console.log("app started on port", env.listen.port);
  } catch (err) {
    console.error(err);
  }
}

listen();
