import type { ObjectId } from "mongodb";
import type { OAuthScope } from "@bgs/models";
import { colls } from "../config/db.ts";
import { env } from "../config/index.ts";

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
 * Scopes the user has NOT yet granted this client. Returns `[]` when nothing is
 * missing, including for trusted clients: first-party ones listed in
 * `env.oauth2.trustedClients`, and (out-of-band escape hatch) any client with
 * `trusted: true` on the stored per-user consent doc.
 */
export async function missingConsentScopes(
	userId: ObjectId,
	clientId: string,
	scopes: OAuthScope[],
): Promise<OAuthScope[]> {
	if (env.oauth2.trustedClients.includes(clientId)) {
		return [];
	}
	const consent = await colls.oauthConsents.findOne({ userId, clientId });
	if (consent?.trusted) {
		return [];
	}
	const granted = new Set(consent?.scopes ?? []);
	return scopes.filter((scope) => !granted.has(scope));
}
