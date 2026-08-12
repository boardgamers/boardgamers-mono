import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zDate, zObjectId } from "./helpers.ts";

/** OIDC scopes a CIMD client may request. `role` exposes the user's authority (e.g. admin) as a claim. */
export const oauthScopeSchema = z.enum(["openid", "profile", "email", "role"]);
export type OAuthScope = z.infer<typeof oauthScopeSchema>;

/**
 * Recorded user consent for an OAuth2/OIDC client (issue #76): the user approved
 * this client to receive the listed scopes. Checked at authorize time; since CIMD
 * clients are self-asserted (anyone can host a Client ID Metadata Document),
 * consent is required for every client by default.
 *
 * The `trusted` flag is the future escape hatch for first-party clients (e.g. the
 * forum): a trusted client skips the consent screen. It is only ever set out of
 * band (never writable through an API), so today every row has `trusted` absent.
 */
export const oauthConsentSchema = z.object({
	_id: zObjectId().optional(),
	userId: zObjectId(),
	/** The client's Client Identifier URL (exact string). */
	clientId: z.string(),
	scopes: z.array(oauthScopeSchema),
	/** First-party trusted clients skip the consent screen (nothing is trusted yet). */
	trusted: z.boolean().optional(),
	createdAt: zDate(),
	/** Last time the user re-confirmed / used this consent (updated on every authorize). */
	lastUsedAt: zDate().optional(),
});

export type OAuthConsentDoc = z.output<typeof oauthConsentSchema>;

export const OAUTH_CONSENTS_COLLECTION = "oauthconsents";

export const oauthConsentIndexes: IndexDescription[] = [{ key: { userId: 1, clientId: 1 }, unique: true }];
