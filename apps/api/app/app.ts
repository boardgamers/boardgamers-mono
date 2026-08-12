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
import { colls } from "./config/db.ts";
import { accessTokenPayloadSchema, lookupRefreshToken } from "./models/jwtrefreshtokens.ts";
import { authenticateAdminToken } from "./models/admintokens.ts";
import { notifyLogin, notifyLastIp } from "./models/user.ts";
import { setRefreshCookie, parseRefreshCookie, clearAllRefreshCookieVariants } from "./models/session.ts";

// Throttle sliding-session cookie refreshes (per refresh code) so active users
// don't rewrite the cookie / bump lastSeen on every single mutating request.
const REFRESH_SLIDE_INTERVAL_MS = 60 * 1000;
const refreshSlideThrottle = new Map<string, number>();

// Mutating endpoints that legitimately take a non-JSON body, exempt from the CSRF
// JSON gate (still covered by the cross-site Origin/Sec-Fetch-Site check):
//  - /api/oauth2/token — application/x-www-form-urlencoded per RFC6749, called
//    server-to-server by OAuth clients (no cookie), form is mandatory.
//  - /api/account/avatar — raw image bytes (the web app POSTs a File).
const CSRF_JSON_EXEMPT = /^\/api\/(oauth2\/token|account\/avatar)\/?$/;

/** True when `origin` is same-site with the request host (subdomains of env.domain count). Exported for tests. */
export function isSameSiteOrigin(ctx: { hostname: string }, origin: string): boolean {
	let host: string;
	try {
		host = new URL(origin).hostname.toLowerCase();
	} catch {
		return false;
	}
	const requestHost = ctx.hostname.toLowerCase();
	if (host === requestHost) {
		return true;
	}
	// Behind nginx the api may see the bare domain while the browser's Origin is the
	// www/app subdomain (or vice versa) — treat the whole site domain as same-site.
	const domain = env.domain.toLowerCase();
	const inDomain = (h: string) => h === domain || h.endsWith(`.${domain}`);
	return inDomain(host) && inDomain(requestHost);
}
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

	// CSRF guard for cookie-authenticated state changes. The session cookie is
	// SameSite=Lax, so it rides top-level cross-site POST navigations (a plain HTML
	// form), and koa-bodyparser accepts any content type — so without this a
	// cross-site auto-submitted form could mutate the victim's account (e.g. record
	// OAuth consent). Defence in depth, applied only when a session cookie actually
	// authenticated the request (bearer-token API clients are not CSRF-able and are
	// left alone):
	//  1. Cross-site marker: if the request is explicitly marked cross-site
	//     (Sec-Fetch-Site: cross-site, or a foreign Origin), reject — fail-open only
	//     when the client sends no marker at all (older browsers, non-browser tools).
	//  2. Body gate: POSTs must carry application/json, which forces a CORS
	//     preflight a cross-origin HTML form can't pass. POST is the only verb a
	//     native form can submit with a CORS-safelisted content type — forms
	//     can't send DELETE/PUT/PATCH, and a cross-site fetch with those verbs
	//     is preflighted, so they rely on the cross-site check above alone
	//     (which is also why a bodyless DELETE needs no Content-Type). Exempted:
	//     the genuinely form-encoded / binary endpoints (OAuth2 token, per
	//     RFC6749, and the raw avatar upload).
	app.use(async (ctx, next) => {
		if (["GET", "HEAD", "OPTIONS"].includes(ctx.method)) {
			return next();
		}
		// Only cookie-auth is CSRF-able; a Bearer caller never relies on ambient cookies.
		if (!ctx.cookies.get("refreshToken") || ctx.get("Authorization")) {
			return next();
		}
		const fetchSite = ctx.get("sec-fetch-site");
		if (fetchSite === "cross-site") {
			throw createError(403, "cross-site request rejected");
		}
		// Origin present-but-foreign is a cross-site signal (Sec-Fetch-Site absent on
		// some clients); no Origin at all is left to the JSON gate below.
		const origin = ctx.get("origin");
		if (origin && !isSameSiteOrigin(ctx, origin)) {
			throw createError(403, "cross-site origin rejected");
		}
		// Only POST is form-submittable, hence the only verb a cross-site form could
		// reach with a safelisted (no-preflight) content type — so it's the only verb
		// that needs the JSON content-type gate. DELETE/PUT/PATCH can't come from a
		// form and are preflighted cross-site; the cross-site check above covers them.
		if (ctx.method === "POST" && !ctx.is("application/json") && !CSRF_JSON_EXEMPT.test(ctx.path)) {
			throw createError(415, "mutating requests require a JSON body");
		}
		return next();
	});

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

			// Admin token auth (issue #105): a Bearer credential that isn't a valid JWT
			// is looked up by hash in `admintokens` — but only under /api/admin. A hit
			// authenticates as the owning admin while the token is unexpired, unrevoked,
			// and the owner still has authority === "admin". Outside /api/admin the
			// credential resolves to no user at all, so it can never act as a session on
			// account/game routes — no per-route rejection needed. (ctx.path is still the
			// full path here; routers strip their prefix later.)
			if (!ctx.state.user && (ctx.path === "/api/admin" || ctx.path.startsWith("/api/admin/"))) {
				const adminAuth = await authenticateAdminToken(token);
				if (adminAuth) {
					ctx.state.user = adminAuth.user;
					ctx.state.adminToken = adminAuth.viaAdminToken;
				}
			}
		} else {
			const { token } = tokenQuerySchema.parse(ctx.query);
			if (token) {
				await processToken(token);
			}
		}

		// Cookie session auth: if no bearer token resolved a user, fall back to the
		// long-lived refresh-token cookie. This is the primary auth mechanism for the
		// web app (browser + SSR-forwarded cookie); bearer tokens remain for the
		// game-server (gameplay scope) and API clients.
		if (!ctx.state.user) {
			const raw = ctx.cookies.get("refreshToken");
			const code = parseRefreshCookie(raw);
			if (code) {
				const rt = await lookupRefreshToken(code);
				if (!rt) {
					// Dead session cookie (revoked or expired server-side). Clear all variants so a
					// stale pre-overhaul host-only cookie can't shadow future logins (see session.ts).
					clearAllRefreshCookieVariants(ctx);
				}
				if (rt) {
					const sessionUser = await colls.users.findOne({ _id: rt.user });
					ctx.state.user = sessionUser ?? undefined;

					// Sliding session: extend the cookie + bump lastSeen on mutating activity,
					// throttled so we don't rewrite the cookie / hit the DB on every request.
					const isMutating = !["GET", "HEAD", "OPTIONS"].includes(ctx.method);
					if (sessionUser && isMutating) {
						const last = refreshSlideThrottle.get(code) ?? 0;
						if (Date.now() - last > REFRESH_SLIDE_INTERVAL_MS) {
							refreshSlideThrottle.set(code, Date.now());
							setRefreshCookie(ctx, code, "sliding-session");
							colls.users.updateOne({ _id: rt.user }, { $set: { "security.lastSeen": new Date() } }).catch(() => {});
						}
					}
				}
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
					// Game-scoped requests carry the game id as a route param — record it so
					// admin error listings can jump straight to the offending game.
					const gameId: string | undefined = ctx.params?.gameId ?? ctx.params?.id ?? ctx.state.game?._id;
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
							gameId,
						},
						createdAt: new Date(),
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
