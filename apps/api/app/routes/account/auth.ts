import type { Context, Next } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import { z } from "zod";
import { createPendingSignup } from "../../models/oauthflows.ts";
import { huggingfaceStrategy, requestOrigin } from "../../config/passport.ts";
import { sendAuthInfo } from "./utils.ts";

const router = new Router<Application.DefaultState, Context>();

// passport.authenticate accepts a strategy NAME or a strategy INSTANCE at runtime, but
// @types/koa-passport only declares the string form. Hugging Face's CIMD strategy is
// built per request origin, so it must be passed as an instance.
type Middleware = ReturnType<ReturnType<typeof passport.authenticate>>;
function authenticateWith(
	strategy: string | ReturnType<typeof huggingfaceStrategy>,
	options: object,
	callback?: (...args: unknown[]) => unknown,
): Middleware {
	return (
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy instances are valid at runtime
		(
			passport.authenticate as (
				strategy: string | ReturnType<typeof huggingfaceStrategy>,
				options: object,
				callback?: (...args: unknown[]) => unknown,
			) => Middleware
		)(strategy, options, callback)
	);
}

const socialFeedbackSchema = z.object({
	createSocialAccount: z.boolean(),
	provider: z.string(),
	id: z.string(),
	socialMeta: z.object({ username: z.string(), url: z.string() }).optional(),
});

// ---------------------------------------------------------------------------
// Redirect-only OAuth (no client-side "Signing you in…" interstitial, #155)
//
// The API owns the whole round-trip with full navigations only:
//   1. GET /api/account/auth/<provider> — store PKCE state server-side (Mongo,
//      see config/passport.ts) and redirect to the provider.
//   2. The provider-registered callback is the API itself:
//      /api/account/auth/<provider>/callback?code=…&state=…
//   3. The callback exchanges the code, verifies state+PKCE, then 303s:
//        - existing/linked user → Set-Cookie session (sendAuthInfo), /account
//        - new user             → /signup?ticket=<single-use, 15-min server-side
//                                 pending-signup ticket> (no signup JWT in the URL
//                                 anymore — nothing sensitive reaches logs/history)
//        - error                → /login?error=…
//
// Hugging Face needs NO registered callback at all: it uses CIMD, where the
// client_id is the env's own /.well-known/oauth-cimd URL (served by the web app) and
// that doc names the env's own /auth/huggingface/callback as the redirect. So each
// environment (prod + every PR preview) does HF login directly — there is no prod
// redirect-relay. The other providers (google/discord/facebook/github) still require
// pre-registered OAuth apps with fixed callbacks, so on preview envs their social
// login simply isn't wired up (acceptable; only HF works on previews).
// ---------------------------------------------------------------------------

// The web app shares the API's origin (vite proxy in dev, nginx in prod), so the
// request origin is the right base for post-auth redirects.
const webUrl = (ctx: Context, path: string) => `${ctx.protocol}://${ctx.host}${path}`;

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
	// CIMD: the strategy (and its client_id) is specific to this request's origin.
	await authenticateWith(huggingfaceStrategy(requestOrigin(ctx)), {
		scope: ["openid", "profile"],
		callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/huggingface/callback`,
	})(ctx, next);
});

// Custom passport callback: on OAuth failure, bounce to the login page with an
// error instead of passport's default failureRedirect (which would land on the
// API root with no feedback).
function authenticateCallback(ctx: Context, next: Next, provider: string): Promise<void> {
	const strategy = provider === "huggingface" ? huggingfaceStrategy(requestOrigin(ctx)) : provider;
	return authenticateWith(
		strategy,
		{
			callbackURL: `${ctx.protocol}://${ctx.hostname}/auth/${provider}/callback`,
			session: false,
		},
		async (err: unknown) => {
			if (err) {
				redirectAfterAuth(ctx, `/login?error=${encodeURIComponent("Social login failed")}`);
				return;
			}
			await next();
		},
	)(ctx, next);
}

router.get(
	"/:provider/callback",
	async (ctx, next) => {
		await authenticateCallback(ctx, next, ctx.params.provider);
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
	socialMeta?: { username: string; url: string },
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
