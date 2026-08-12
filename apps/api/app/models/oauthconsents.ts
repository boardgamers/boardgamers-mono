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
	const now = new Date();
	const doc = {
		userId,
		clientId,
		scopes: [...new Set(scopes)],
		createdAt: now,
		lastUsedAt: now,
	};
	// createdAt must only be set on insert ($setOnInsert would reset it on re-consent otherwise);
	// lastUsedAt tracks the most recent use for the dead-user cleanup.
	const { createdAt, lastUsedAt, ...rest } = doc;
	await colls.oauthConsents.updateOne(
		{ userId, clientId },
		{ $set: { ...rest, lastUsedAt }, $setOnInsert: { createdAt } },
		{ upsert: true },
	);
	return doc;
}

/** Bump the consent's lastUsedAt — cheap proof-of-life for the dead-user cleanup. */
export async function touchConsent(userId: ObjectId, clientId: string) {
	await colls.oauthConsents.updateOne({ userId, clientId }, { $set: { lastUsedAt: new Date() } });
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
