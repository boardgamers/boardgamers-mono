import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId } from "./helpers.ts";
import { oauthScopeSchema } from "./oauthconsent.ts";
import { socialMetaEntrySchema } from "./user.ts";

/**
 * Server-side state for an in-flight OAuth flow: the social-login PKCE handshake,
 * pending social signups, and the OAuth2/OIDC provider's authorization codes
 * (issue #76). Single-use, short-lived.
 *
 * Deliberately server-side rather than a cookie: the PKCE code_verifier is a bearer
 * secret, so keeping it out of the browser entirely beats even an httpOnly cookie
 * (which rides every request), and deleting the doc on first use is genuinely
 * single-use (a cookie clears only when the response reaches the browser). Mongo
 * also makes the flow survive restarts and work across PM2 workers with no sticky
 * routing — and the pending-signup ticket is redeemed cross-origin after the OAuth
 * callback, which a cookie couldn't do at all.
 *
 * Verifiers and pending signups are NOT personal data — they are single-use and
 * expire within minutes (TTL index below).
 */
export const oauthFlowSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("oauth-state"),
		/** Random handle, also sent as the OAuth `state` param (indexed, single-use). */
		_id: z.string(),
		codeVerifier: z.string(),
		expiresAt: z.date(),
	}),
	z.object({
		kind: z.literal("pending-signup"),
		/** One-time ticket in the /signup?ticket=… redirect. */
		_id: z.string(),
		provider: z.string(),
		socialId: z.string(),
		socialMeta: socialMetaEntrySchema.optional(),
		expiresAt: z.date(),
	}),
	z.object({
		kind: z.literal("oauth-code"),
		/** The authorization code itself: a 192-bit random value. */
		_id: z.string(),
		/** Client Identifier URL (CIMD) the code was issued to. */
		clientId: z.string(),
		/** Stored to re-check at token redemption (mix-up defense). */
		redirectUri: z.string(),
		user: zObjectId(),
		scopes: z.array(oauthScopeSchema),
		codeChallenge: z.string(),
		codeChallengeMethod: z.literal("S256"),
		expiresAt: z.date(),
	}),
]);

export type OAuthFlowDoc = z.output<typeof oauthFlowSchema>;

export const OAUTH_FLOWS_COLLECTION = "oauthflows";

export const oauthFlowIndexes: IndexDescription[] = [
	// auto-expire all flow state shortly after its own deadline
	{ key: { expiresAt: 1 }, expireAfterSeconds: 600 },
];
