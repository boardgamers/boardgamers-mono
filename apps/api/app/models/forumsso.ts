import type { Context } from "koa";
import jwt from "jsonwebtoken";
import type { WithId } from "mongodb";
import type { UserDoc } from "@bgs/models";
import { env } from "../config/index.ts";

/**
 * Forum SSO cookie: a short-lived JWT ({ id, username, email }) the forum
 * validates with our public key to log the user in transparently.
 */
export const FORUM_SSO_COOKIE = "token";

export const FORUM_SSO_TOKEN_DURATION_S = 3600;

/** Re-sign when under half the token's life remains — not on every request. */
const REISSUE_THRESHOLD_S = FORUM_SSO_TOKEN_DURATION_S / 2;

const setOptions = () => ({
	httpOnly: true,
	sameSite: true as const,
	domain: env.isProduction ? env.domain : undefined,
});

/** Set the forum SSO cookie (fresh 1h JWT). Also re-signs when the payload changed. */
export function setForumSsoCookie(ctx: Context, user: WithId<UserDoc>) {
	const token = jwt.sign(
		{
			id: user._id.toString(),
			username: user.account.username,
			email: user.account.email,
		},
		env.jwt.keys.private,
		{ expiresIn: FORUM_SSO_TOKEN_DURATION_S, algorithm: env.jwt.algorithm },
	);
	ctx.cookies.set(FORUM_SSO_COOKIE, token, setOptions());
}

/**
 * Re-issue the forum SSO cookie only when the incoming one is unusable (absent,
 * invalid, payload drift) or under half its life remains. Signing is RS256 in
 * prod — doing it on every authenticated request wastes CPU and bloats every
 * response with Set-Cookie headers (issue #152).
 */
export function reissueForumSsoCookieIfNeeded(
	ctx: Context,
	user: WithId<UserDoc>,
	nowS = Math.floor(Date.now() / 1000),
) {
	const payload = {
		id: user._id.toString(),
		username: user.account.username,
		email: user.account.email,
	};

	const raw = ctx.cookies.get(FORUM_SSO_COOKIE);
	if (raw) {
		try {
			const decoded = jwt.verify(raw, env.jwt.keys.public, { algorithms: [env.jwt.algorithm] });
			if (
				typeof decoded === "object" &&
				decoded.id === payload.id &&
				decoded.username === payload.username &&
				decoded.email === payload.email &&
				typeof decoded.exp === "number" &&
				decoded.exp - nowS > REISSUE_THRESHOLD_S
			) {
				return false;
			}
		} catch {
			// Unverifiable cookie (bad signature, expired, malformed) — re-issue below.
		}
	}

	setForumSsoCookie(ctx, user);
	return true;
}

/**
 * Clear the forum SSO cookie on logout: BOTH the domain variant (prod sets
 * Domain=env.domain) and the host-only variant. A Set-Cookie clear only matches
 * on identical name+domain+path, so a single clear leaves the other variant
 * behind as a stale shadow cookie (issue #152).
 */
export function clearForumSsoCookie(ctx: Context) {
	ctx.cookies.set(FORUM_SSO_COOKIE, null, { ...setOptions(), maxAge: 0 });
	if (env.isProduction) {
		ctx.cookies.set(FORUM_SSO_COOKIE, null, { httpOnly: true, sameSite: true, maxAge: 0 });
	}
}
