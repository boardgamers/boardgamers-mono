import type { ObjectId } from "mongodb";
import type { OAuthScope } from "@bgs/models";
import { colls } from "../config/db.ts";

/**
 * OAuth2/OIDC provider consent store (issue #76): which user granted which scopes
 * to which CIMD client.
 */

/** Record (or refresh) the user's consent for a client. Returns the stored doc. */
export async function recordConsent(userId: ObjectId, clientId: string, scopes: OAuthScope[]) {
	const doc = {
		userId,
		clientId,
		scopes: [...new Set(scopes)],
		createdAt: new Date(),
	};
	await colls.oauthConsents.updateOne({ userId, clientId }, { $set: doc }, { upsert: true });
	return doc;
}

/**
 * Scopes the user has NOT yet granted this client, or null when the client is
 * trusted (trusted clients — set out of band on the stored doc — skip consent;
 * nothing is trusted yet, this is the escape hatch for future first-party clients).
 * `[]` means consent covers everything requested — authorize can proceed.
 */
export async function missingConsentScopes(
	userId: ObjectId,
	clientId: string,
	scopes: OAuthScope[],
): Promise<OAuthScope[] | null> {
	const consent = await colls.oauthConsents.findOne({ userId, clientId });
	if (consent?.trusted) {
		return null;
	}
	const granted = new Set(consent?.scopes ?? []);
	return scopes.filter((scope) => !granted.has(scope));
}
