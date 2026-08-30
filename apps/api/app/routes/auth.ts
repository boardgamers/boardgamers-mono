import type { Context, Next } from "koa";
import createError from "http-errors";
import passport from "koa-passport";
import Router from "koa-router";
import { z } from "zod";
import { createPendingSignup } from "../models/oauthflows.ts";
import { verifySocialProfile } from "../config/passport.ts";
import { pkceStart, pkceCallback, githubConfig, huggingfaceConfig } from "../config/pkce.ts";
import { sendAuthInfo } from "./account/utils.ts";
import env from "../config/env.ts";

const router = new Router<Application.DefaultState, Context>();

const socialFeedbackSchema = z.object({
	createSocialAccount: z.boolean(),
	provider: z.string(),
	id: z.string(),
	socialMeta: z
		.object({ username: z.string(), url: z.string().optional(), avatarUrl: z.string().optional() })
		.optional(),
});

// ---------------------------------------------------------------------------
// Redirect-only OAuth (no client-side "Signing you in…" interstitial, #155),
// mounted at the top-level /auth (no /api/account prefix, #248).
//
// The API owns the whole round-trip with full navigations only:
//   1. GET /auth/<provider> — store PKCE state server-side (Mongo,
//      see config/pkce.ts) and redirect to the provider.
//   2. The provider-registered callback is the API itself:
//      /auth/<provider>/callback?code=…&state=…
//   3. The callback exchanges the code, verifies state+PKCE, then 303s:
//        - existing/linked user → Set-Cookie session (sendAuthInfo), /account
//        - new user             → /signup?ticket=<single-use, 15-min server-side
//                                 pending-signup ticket> (no signup JWT in the URL
//                                 anymore — nothing sensitive reaches logs/history)
//        - error                → /login?error=…
//
// GitHub and Hugging Face use hand-rolled PKCE (config/pkce.ts) — no passport,
// no client secret. Discord/Google/Facebook keep passport strategies (they're
// confidential clients with pre-registered secrets).
//
// Hugging Face needs NO registered callback at all: it uses CIMD, where the
// client_id is the env's own /.well-known/oauth-cimd URL (served by the web app)
// and that doc names the env's own /auth/huggingface/callback as the
// redirect. So each environment (prod + every PR preview) does HF login directly
// — there is no prod redirect-relay. The other providers (google/discord/facebook/
// github) still require pre-registered OAuth apps with fixed callbacks, so on
// preview envs their social login simply isn't wired up (acceptable; only HF
// works on previews).
//
// Reachability (#248): the web app proxies /auth/* here (apps/web
// src/routes/auth/[...path]/+server.ts) — prod nginx only routes /api/* to the api,
// so no nginx change is needed (PR-preview nginx routes /auth/* directly; both paths
// are equivalent). Each provider's OAuth app must list the /auth/<provider>/callback
// redirect URI.
// ---------------------------------------------------------------------------

// The web app shares the API's origin (vite proxy in dev, nginx in prod), so the
// request origin is the right base for post-auth redirects.
const webUrl = (ctx: Context, path: string) => `${ctx.protocol}://${ctx.host}${path}`;

// The provider callback is this router's own route (mounted at /auth). This must
// also match the CIMD doc's redirect_uris.
function socialCallbackUrl(ctx: Context, provider: string): string {
	return `${ctx.protocol}://${ctx.hostname}/auth/${provider}/callback`;
}

// --- Passport-based providers (discord, google, facebook) ---

function socialStartOptions(ctx: Context, provider: string, scope: string[]) {
	return {
		scope,
		callbackURL: socialCallbackUrl(ctx, provider),
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

// --- PKCE providers (github, huggingface) — no passport, no client secret ---

router.get("/github", async (ctx) => {
	const { url } = await pkceStart(githubConfig, env.social.github.id, socialCallbackUrl(ctx, "github"));
	ctx.redirect(url);
});

router.get("/huggingface", async (ctx) => {
	// CIMD: the client_id is this origin's own /.well-known/oauth-cimd URL.
	const origin = `${ctx.protocol}://${ctx.host}`;
	const clientId = `${origin}/.well-known/oauth-cimd`;
	const { url } = await pkceStart(huggingfaceConfig, clientId, socialCallbackUrl(ctx, "huggingface"));
	ctx.redirect(url);
});

// --- Callbacks ---

// Passport-based callback: discord/google/facebook.
function authenticateCallback(ctx: Context, next: Next, provider: string): Promise<void> {
	return passport.authenticate(
		provider,
		{
			callbackURL: socialCallbackUrl(ctx, provider),
			session: false,
		},
		async (err: unknown, user: unknown) => {
			if (err || !user) {
				redirectAfterAuth(ctx, `/login?error=${encodeURIComponent("Social login failed")}`);
				return;
			}
			ctx.state.user = user;
			await next();
		},
	)(ctx, next);
}

// PKCE callback: github/huggingface. Verifies state, exchanges code, fetches profile.
// pkceCallback throws descriptive errors — they propagate to the global error handler
// which records them in apierrors (admin health page) and returns the message to the
// browser. No silent redirect-to-login; the user sees what actually went wrong.
async function pkceCallbackHandler(ctx: Context, next: Next, provider: "github" | "huggingface"): Promise<void> {
	// OAuth providers redirect with ?error=…&error_description=… when the user
	// denies consent or something goes wrong provider-side (RFC 6749 §4.1.2.1).
	const errorQuery = z.object({ error: z.string(), error_description: z.string().optional() }).safeParse(ctx.query);
	if (errorQuery.success) {
		throw createError(403, `${provider}: ${errorQuery.data.error_description ?? errorQuery.data.error}`);
	}

	const query = z.object({ code: z.string(), state: z.string() }).parse(ctx.query);

	const config = provider === "github" ? githubConfig : huggingfaceConfig;
	const clientId =
		provider === "github" ? env.social.github.id : `${ctx.protocol}://${ctx.host}/.well-known/oauth-cimd`;
	// GitHub OAuth Apps are confidential clients: they require client_secret even
	// with PKCE. HF CIMD apps are public clients and must NOT send one.
	const clientSecret = provider === "github" ? env.social.github.secret : undefined;
	const redirectUri = socialCallbackUrl(ctx, provider);

	const profile = await pkceCallback(config, clientId, redirectUri, query.code, query.state, clientSecret);
	// Reuse the same link-or-create logic as the passport strategies.
	const user = await verifySocialProfile(provider, { user: ctx.state.user }, profile);
	ctx.state.user = user;
	await next();
}

router.get(
	"/:provider/callback",
	async (ctx, next) => {
		const provider = ctx.params.provider;
		if (provider === "github" || provider === "huggingface") {
			await pkceCallbackHandler(ctx, next, provider);
		} else {
			await authenticateCallback(ctx, next, provider);
		}
	},
	async (ctx) => {
		await finishSocialAuth(ctx, ctx.params.provider);
	},
);

// Shared tail of the social callback: turns the passport result into either
// a redirect to signup with a pending-signup ticket (new social account) or a session
// cookie + redirect to the account page. Exported for the auth spec.
export async function finishSocialAuth(ctx: Context, provider: string): Promise<void> {
	const feedback = socialFeedbackSchema.safeParse(ctx.state.user);
	if (feedback.success && feedback.data.createSocialAccount) {
		ctx.state.user = undefined;
		await redirectToSignup(ctx, provider, feedback.data.id, feedback.data.socialMeta);
		return;
	}
	await sendAuthInfo(ctx, provider);
	redirectAfterAuth(ctx, "/account");
}

// 303 See Other: the right status for the POST→GET redirect after an auth
// mutation (and harmless for the GET callbacks).
function redirectAfterAuth(ctx: Context, path: string): void {
	ctx.status = 303;
	ctx.redirect(webUrl(ctx, path));
}

// New social account: park the signup data server-side (single-use, short TTL) and
// send the browser to the signup page with just the ticket — no JWT in the URL.
async function redirectToSignup(
	ctx: Context,
	provider: string,
	socialId: string,
	socialMeta?: { username: string; url?: string; avatarUrl?: string },
): Promise<void> {
	const ticket = await createPendingSignup({
		provider,
		socialId,
		...(socialMeta ? { socialMeta } : {}),
		expiresAt: new Date(Date.now() + 15 * 60 * 1000),
	});
	redirectAfterAuth(ctx, `/signup?ticket=${ticket}`);
}

export default router;
