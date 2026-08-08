import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Context } from "koa";
import createError from "http-errors";
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
	socialMeta: z.object({ username: z.string(), url: z.string() }).optional(),
});

// ---------------------------------------------------------------------------
// OAuth redirect sharing ("relay")
//
// Problem: each OAuth app has ONE registered redirect URI — prod's
// `https://www.boardgamers.space/auth/<provider>/callback`. Ephemeral envs
// (PR previews on pr-<n>.boardgamers.space) therefore can't complete social
// login on their own origin.
//
// Mechanism: all envs start login on PROD (the registered redirect). Prod's
// state store (config/passport.ts) carries a `returnTo` origin through the
// handshake; on the callback prod swaps the result for a single-use, 5-minute
// code kept in memory and redirects back to the allowlisted origin with it.
// The requesting env exchanges that code (POST /relay/exchange-code) and
// completes login/signup exactly as if its own callback had run.
//
// Security: returnTo is allowlisted (exact *.boardgamers.space hosts, https
// only), the relay code is single-use + short-lived, and it never reaches
// logs/analytics beyond the preview's own address bar. The code is worthless
// without this server's in-memory map, so intercepting it off-server gains
// nothing unless redeemed here first.
// ---------------------------------------------------------------------------

type RelayTicket =
	| { kind: "auth"; payload: Context["state"]["user"]; expiresAt: number }
	| { kind: "signup"; feedback: z.infer<typeof socialFeedbackSchema>; expiresAt: number };

const relayTickets = new Map<string, RelayTicket>();

function pruneTickets() {
	const now = Date.now();
	for (const [code, ticket] of relayTickets) {
		if (ticket.expiresAt <= now) {
			relayTickets.delete(code);
		}
	}
}

// Exact-host allowlist: `www.boardgamers.space` and `pr-42.boardgamers.space` are
// allowed by the "boardgamers.space" suffix; `evil-boardgamers.space` or
// `a.b.boardgamers.space` are not. https only outside local development.
function assertAllowedReturnTo(returnTo: string): void {
	let url: URL;
	try {
		url = new URL(returnTo);
	} catch {
		throw createError(400, "Invalid returnTo origin");
	}
	if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
		throw createError(400, "returnTo origin must be https");
	}
	const host = url.hostname.toLowerCase();
	const allowed = env.oauthRelay.allowedOriginSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
	if (!allowed) {
		throw createError(400, "returnTo origin is not allowed");
	}
}

function takeRelayTicket(code: string): RelayTicket {
	pruneTickets();
	const ticket = relayTickets.get(code);
	relayTickets.delete(code);
	if (!ticket || ticket.expiresAt <= Date.now()) {
		throw createError(401, "Invalid or expired oauth relay code");
	}
	return ticket;
}

function socialStartOptions(ctx: Context, provider: string, scope: string[]) {
	return {
		scope,
		callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/${provider}/callback`,
	};
}

router.get("/google", async (ctx, next) => {
	await passport.authenticate("google", socialStartOptions(ctx, "google", ["openid"]))(ctx, next);
});

router.get("/discord", async (ctx, next) => {
	await passport.authenticate("discord", socialStartOptions(ctx, "discord", ["identify"]))(ctx, next);
});

router.get("/facebook", async (ctx, next) => {
	await passport.authenticate("facebook", socialStartOptions(ctx, "facebook", []))(ctx, next);
});

router.get("/github", async (ctx, next) => {
	await passport.authenticate("github", socialStartOptions(ctx, "github", ["read:user"]))(ctx, next);
});

router.get("/huggingface", async (ctx, next) => {
	// Relay start: with a returnTo, this request kicks off the handshake on the
	// registered (prod) origin and bounces the result back to the requester.
	const { returnTo } = z.object({ returnTo: z.string().optional() }).parse(ctx.query);
	if (returnTo !== undefined) {
		assertAllowedReturnTo(returnTo);
	}
	await passport.authenticate("huggingface", {
		...socialStartOptions(ctx, "huggingface", []),
		// The custom state store (passport.ts) picks returnTo up from the query.
	})(ctx, next);
});

// The requesting env redeems a relay code for the auth result prod produced.
// Only PKCE (huggingface) is relayed, so the provider stamp is fixed.
router.post("/relay/exchange-code", async (ctx) => {
	const { code } = z.object({ code: z.string().min(1) }).parse(ctx.request.body);
	const ticket = takeRelayTicket(code);
	ctx.state.user = ticket.kind === "signup" ? ticket.feedback : ticket.payload;
	await finishSocialAuth(ctx, "huggingface");
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
		// Relay flow: if the OAuth state carried an allowlisted returnTo, stash the
		// result behind a one-time code and bounce back to the requesting origin
		// instead of completing the login here.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- augmented in config/passport.ts
		const p = passport as unknown as { consumeRelayReturnTo?(h: unknown): string | undefined };
		const returnTo = p.consumeRelayReturnTo?.(ctx.query.state);
		if (returnTo) {
			await relayCallbackRedirect(ctx, ctx.params.provider, returnTo);
			return;
		}
		await finishSocialAuth(ctx, ctx.params.provider);
	},
);

// Shared tail of the social callback (and of the relay exchange): turns the
// passport result into either a signup JWT (new social account) or full auth info.
async function finishSocialAuth(ctx: Context, provider: string): Promise<void> {
	const feedback = socialFeedbackSchema.safeParse(ctx.state.user);
	if (feedback.success && feedback.data.createSocialAccount) {
		const { id, socialMeta } = feedback.data;

		ctx.state.user = undefined;

		const body = {
			createSocialAccount: true,
			provider,
			id,
			socialMeta,
		};

		ctx.body = {
			...body,
			jwt: jwt.sign(body, env.jwt.keys.private, { expiresIn: "1h", algorithm: env.jwt.algorithm }),
		};
	} else {
		await sendAuthInfo(ctx, provider);
	}
}

// Prod-side tail of the relay: stash the result and bounce to the origin that
// started the handshake. Wired behind the state store's returnTo, so it only
// triggers for flows that explicitly opted in via /huggingface?returnTo=…
export async function relayCallbackRedirect(ctx: Context, provider: string, returnTo: string): Promise<void> {
	assertAllowedReturnTo(returnTo);

	const feedback = socialFeedbackSchema.safeParse(ctx.state.user);
	const code = crypto.randomBytes(24).toString("base64url");
	relayTickets.set(
		code,
		feedback.success && feedback.data.createSocialAccount
			? { kind: "signup", feedback: feedback.data, expiresAt: Date.now() + env.oauthRelay.codeTtlMs }
			: { kind: "auth", payload: ctx.state.user, expiresAt: Date.now() + env.oauthRelay.codeTtlMs },
	);

	// Do NOT log the URL with the code — address-bar only, single-use.
	const target = new URL("/auth/" + provider + "/callback", returnTo);
	target.searchParams.set("oauthCode", code);
	ctx.redirect(target.toString());
}

export default router;
