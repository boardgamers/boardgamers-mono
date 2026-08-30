import assert from "node:assert";
import createError from "http-errors";
import type { Context, Next } from "koa";
import type { ObjectId } from "mongodb";
import { colls } from "../config/db.ts";

// Per-authenticated-user, per-action rate limiting (#195), counted in mongo.
// Unlike the per-IP auth limiter (services/ratelimit.ts — in-memory, per
// PM2-process, for unauthenticated enumeration endpoints), these actions are
// authenticated and low-volume, so a shared store is both affordable and
// correct across the PM2 cluster.
//
// The window is "fixed" in the strict sense: bucketed by floor(now/windowMs).
// One counter doc per (userId, action, windowStart), $inc-ed per hit, with a
// TTL index that reclaims docs two windows after their start (see
// packages/models/useraction.ts).

const DUPLICATE_KEY = 11000;

export type ActionRateLimitOptions = { max: number; windowMs: number };

// Per-action limits, in code. Every actionRateLimit consumer registers its
// action here so all limits are visible (and tunable) in one place; a future
// config UI would just override entries of this map. Registering ALSO makes
// the test-suite relaxation work for the action (see setActionRateLimitsForTests).
export const ACTION_RATE_LIMITS: Record<string, ActionRateLimitOptions> = {
	// POST /account/email — changing the account email sends a notice to the old
	// address and a confirmation link to the new one.
	"account/email": { max: 5, windowMs: 60 * 60 * 1000 },
	// POST /account/webhook/test — an authenticated trigger for an outbound POST
	// to a user-supplied URL (#85/#33); cap it so the api can't be used to fan
	// out request volume.
	"account/webhook/test": { max: 10, windowMs: 60 * 60 * 1000 },
	// DELETE /account/social/:provider — unlinking a login method is sensitive
	// (account-takeover cleanup path); cap it like account/email.
	"account/social/unlink": { max: 5, windowMs: 60 * 60 * 1000 },
	// POST/DELETE /boardgame/:game/like — idempotent set/unset; the cap only bites
	// rapid like-spam across many games (the like itself is a cheap unique-keyed upsert).
	"boardgame/like": { max: 60, windowMs: 60 * 1000 },
	// POST /boardgame/request — whole-game requests (#340). Spam guard: no karma
	// minimum to request, so cap the creation rate (a per-user open-request cap
	// is also enforced by the route itself).
	"boardgame/request": { max: 10, windowMs: 24 * 60 * 60 * 1000 },
	// POST /feedback — site + game-specific requests (#340). Same rationale.
	"feedback/create": { max: 10, windowMs: 24 * 60 * 60 * 1000 },
	// PUT/DELETE /feedback/:id/like — idempotent set/unset, mirrors boardgame/like.
	"feedback/like": { max: 60, windowMs: 60 * 1000 },
	// PUT/DELETE /game/:gameId/chat/:messageId/reaction/:emoji (#438) — idempotent
	// set/unset, mirrors boardgame/like.
	"game/chat-reaction": { max: 60, windowMs: 60 * 1000 },
	// POST /admin/page/:name/:lang/translate (#306) — every call is two paid LLM
	// completions (title + content), so cap it per admin. Site admins
	// (authority === "admin") are exempt — see SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-page": { max: 20, windowMs: 60 * 60 * 1000 },
	// POST /admin/page/translate-bulk (#306) — one run is up to
	// BULK_TRANSLATE_MAX_PAIRS × two paid LLM completions (a whole language
	// refresh, or one page into every locale), so only a few runs per hour.
	// Site admins exempt — see SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-bulk": { max: 5, windowMs: 60 * 60 * 1000 },
	// POST /admin/gameinfo/:game/meta/translate (#306) — every call is up to
	// three paid LLM completions (description/rules/credits). Site admins
	// exempt — see SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-gameinfo": { max: 20, windowMs: 60 * 60 * 1000 },
	// POST /admin/gameinfo/:game/meta/translate-all (#306) — one call is up to
	// 9 languages × 3 paid completions, so a much lower cap than the
	// single-language variant (mirrors translate-bulk's 5/h). Site admins
	// exempt — see SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-gameinfo-bulk": { max: 5, windowMs: 60 * 60 * 1000 },
	// POST /admin/translations/translate-metadata-bulk (#306 follow-up) — one
	// run is up to BULK_METADATA_MAX_PAIRS × three paid LLM completions (a
	// whole-language metadata refresh across every game), so only a few runs
	// per hour (mirrors translate-bulk's 5/h). Site admins exempt — see
	// SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-metadata-bulk": { max: 5, windowMs: 60 * 60 * 1000 },
	// POST /admin/changelog/translate-bulk (#306 follow-up) — one run is up to
	// BULK_CHANGELOG_MAX_PAIRS × two paid LLM completions (content + details),
	// so mirror translate-bulk's 5/h. Site admins exempt — see
	// SITE_ADMIN_BYPASSED_ACTIONS.
	"admin/translate-changelog-bulk": { max: 5, windowMs: 60 * 60 * 1000 },
};

// Actions a site admin (authority === "admin") performs without hitting the
// rate limit, enforced in the actionRateLimit middleware. The
// admin/translate-* caps are an LLM-cost guard aimed at scoped admins
// (per-boardgame "gameinfo:<slug>", "pages" and "changelog" grantees), who stay capped;
// the site owner pays the LLM bill and runs platform-wide translation
// maintenance that would otherwise stall on the 5/h bulk caps. Deliberately
// NOT extended to other actions: account/email, feedback, etc. keep applying
// to everyone.
const SITE_ADMIN_BYPASSED_ACTIONS = new Set([
	"admin/translate-page",
	"admin/translate-bulk",
	"admin/translate-gameinfo",
	"admin/translate-gameinfo-bulk",
	"admin/translate-metadata-bulk",
	"admin/translate-changelog-bulk",
]);

let testLimits: ActionRateLimitOptions | null = null;

// Test hook (like setSendmailForTests): fallback limit for actions with no
// registered entry, so the suite can relax every registry-backed action at
// once and specs that aren't about rate limiting never hit it. A registered
// ACTION_RATE_LIMITS entry (or explicit options) always wins over this
// override, so a spec can tighten one action back down via the registry.
export function setActionRateLimitsForTests(limits: ActionRateLimitOptions | null) {
	testLimits = limits;
}

function limitFor(action: string, options?: ActionRateLimitOptions): ActionRateLimitOptions {
	// A concrete registered entry wins over the suite-wide test relaxation, so a
	// spec can tighten one action back down by writing it into the registry.
	const resolved = options ?? ACTION_RATE_LIMITS[action] ?? testLimits;
	assert(resolved, `actionRateLimit: no limit registered for action "${action}"`);
	assert(resolved.max > 0 && resolved.windowMs > 0, `actionRateLimit(${action}): max and windowMs must be > 0`);
	return resolved;
}

/**
 * Count one hit for (userId, action) in the current window and report whether
 * it's within `max`.
 *
 * The counter is a single findOneAndUpdate($inc, upsert): two concurrent first
 * hits race the upsert, the loser gets E11000 from the unique
 * (userId, action, windowStart) index and replays as a plain $inc — so exactly
 * one count is recorded per call, never zero and never double.
 */
export async function recordUserAction(
	userId: ObjectId,
	action: string,
	options: ActionRateLimitOptions,
	now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
	const { max, windowMs } = options;
	assert(max > 0 && windowMs > 0, `recordUserAction(${action}): max and windowMs must be > 0`);

	const windowStart = now - (now % windowMs);
	const filter = { userId, action, windowStart };
	// $setOnInsert only: the schema validator (moderate level) ignores counter
	// bumps on existing docs, but a fresh doc must still be fully shaped.
	const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStart + 2 * windowMs) } };
	const findOptions = { upsert: true, returnDocument: "after" as const };

	let doc;
	try {
		doc = await colls.userActions.findOneAndUpdate(filter, update, findOptions);
	} catch (err) {
		// Concurrent first hit lost the upsert race — replay as a plain $inc.
		// The doc now exists for sure, so no second upsert race is possible.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
		if ((err as { code?: number })?.code !== DUPLICATE_KEY) {
			throw err;
		}
		doc = await colls.userActions.findOneAndUpdate(filter, update, { ...findOptions, upsert: false });
	}

	const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
	return { allowed: (doc?.count ?? 1) <= max, retryAfterSeconds };
}

/**
 * Koa middleware capping how often the logged-in user can perform `action`:
 * after `max` hits within `windowMs` the request 429s with a generic message
 * and a Retry-After header (seconds until the current window rolls over).
 * Mount it after `loggedIn` — it reads ctx.state.user._id:
 *
 *   // 1. register the limit next to the other actions (ACTION_RATE_LIMITS):
 *   "account/email": { max: 5, windowMs: 60 * 60 * 1000 },
 *   // 2. gate the route with it:
 *   router.post("/email", loggedIn, actionRateLimit("account/email"), handler);
 *
 * The optional second argument overrides the registered limit — mostly for
 * specs exercising the throttle itself.
 *
 * Note every hit — even one the handler later rejects — counts. For sensitive
 * actions that's the point: it also caps probing.
 */
export function actionRateLimit(action: string, options?: ActionRateLimitOptions) {
	// Fail fast on a typo'd/unregistered action at route-registration time
	// rather than on the first request. Tests relax the limits through the
	// registry, so this stays enforced there too.
	if (!options) {
		limitFor(action);
	}
	return async (ctx: Context, next: Next) => {
		const userId = ctx.state.user?._id;
		if (!userId) {
			throw createError(401, "You need to be logged in");
		}

		// Site admins skip the translate caps (see SITE_ADMIN_BYPASSED_ACTIONS).
		// ctx.state.user is reloaded from the db on every request (app.ts JWT /
		// session / admin-token auth), so a revoked admin stops bypassing as
		// soon as their next request lands. Scoped admins fall through to the
		// counter like everyone else.
		if (SITE_ADMIN_BYPASSED_ACTIONS.has(action) && ctx.state.user.authority === "admin") {
			await next();
			return;
		}

		const { allowed, retryAfterSeconds } = await recordUserAction(userId, action, limitFor(action, options));
		if (!allowed) {
			ctx.set("Retry-After", String(retryAfterSeconds));
			throw createError(429, "Too many requests, try again later");
		}

		await next();
	};
}
