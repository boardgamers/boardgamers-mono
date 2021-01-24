/* Koa stuff */
import Koa from "koa";
import compression from "koa-compress";
import bodyParser from "koa-bodyparser";
import morgan from "koa-morgan";
import createError from "http-errors";
import jwt from "jsonwebtoken";

/* Configure passport */
import env from "./config/env";
import "./config/db";

/* Local stuff */
import router from "./routes";
import { AssertionError } from "assert";

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
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

async function listen() {
  try {
    const promise = new Promise<void>((resolve, reject) => {
      app.listen(env.port, "localhost", () => resolve());
      app.once("error", (err) => reject(err));
    });

    await promise;

    console.log("app started on port", env.port);
  } catch (err) {
    console.error(err);
  }
}

listen();
