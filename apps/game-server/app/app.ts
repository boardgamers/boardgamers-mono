/* Koa stuff */
import { AssertionError } from "node:assert";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { z, ZodError } from "zod";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import compression from "koa-compress";
import morgan from "koa-morgan";
import { logRequest, matchedRoute } from "@bgs/utils/log";
import { colls } from "./config/db.ts";
/* Configure passport */
import env from "./config/env.ts";
/* Local stuff */
import router from "./routes/index.ts";

const app = new Koa<Koa.DefaultState & { user: { id: string; isAdmin: boolean }; requestId: string }>();

/* App stuff */
app.use(morgan("dev"));
// Assign a request ID, preferring the incoming X-Request-ID header so it
// correlates with the web app / nginx. Echo it back in the response header.
app.use(async (ctx, next) => {
	ctx.state.requestId = ctx.get("x-request-id") || randomUUID();
	await next();
	ctx.set("x-request-id", ctx.state.requestId);
});
app.use(async (ctx, next) => {
	const start = Date.now();
	try {
		await next();
	} finally {
		logRequest("game-server", {
			method: ctx.request.method,
			path: ctx.request.path,
			route: matchedRoute(ctx),
			status: ctx.status,
			durationMs: Date.now() - start,
			ip: ctx.ip,
			userId: ctx.state.user?.id,
			requestId: ctx.state.requestId,
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

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JWT payload shape is fixed by our own signer
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
			const e = err instanceof Error ? err : new Error(String(err));
			ctx.status = 500;
			ctx.body = { message: "Internal error: " + e.message, stack: e.stack };
		}

		// Routine 401 auth checks are expected traffic, not real errors — skip
		// the console dump and DB error record for them.
		const isRoutineAuth = err instanceof createError.HttpError && err.statusCode === 401;
		if (!isRoutineAuth) {
			const e = err instanceof Error ? err : new Error(String(err));
			console.error(err);
			// Gameplay routes are all scoped on /:gameId — record it so admin error
			// listings can jump straight to the offending game.
			const gameId: string | undefined = ctx.params?.gameId;
			await colls.apiErrors.insertOne({
				request: {
					url: ctx.request.originalUrl,
					method: ctx.request.method,
					body: JSON.stringify(ctx.request.body),
					status: ctx.status,
					id: ctx.state.requestId,
				},
				error: {
					name: e.name,
					stack: e.stack ? e.stack.split("\n") : [],
					message: e.message,
				},
				user: ctx.state.user?.id ? new ObjectId(ctx.state.user.id) : undefined,
				meta: {
					source: "game-server",
					gameId,
				},
				createdAt: new Date(),
			});
		}
	}
});

app.use(router.routes());
app.use(router.allowedMethods());

async function listen() {
	let server!: Server;
	const promise = new Promise<void>((resolve, reject) => {
		server = app.listen(env.listen.port, env.listen.host, () => resolve());
		app.once("error", (err) => reject(err));
	});

	await promise;

	console.log("app started on port", env.listen.port);

	return server;
}

export { listen };
