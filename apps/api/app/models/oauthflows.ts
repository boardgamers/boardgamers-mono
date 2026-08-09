import crypto from "node:crypto";
import type { OAuthFlowDoc } from "@bgs/models";
import { colls } from "../config/db.ts";

/**
 * Server-side store for in-flight social OAuth flows (Mongo-backed, so state
 * survives restarts and works across PM2 workers). Server-side over a cookie on
 * purpose: the PKCE verifier is a bearer secret that never enters the browser,
 * and findOneAndDelete is genuinely single-use — see the schema doc in
 * @bgs/models (oauthflow.ts).
 *
 * Lifecycle per flow kind (all single-use, all TTL-expired):
 *  - `oauth-state`    createOAuthState → verifyOAuthState (deletes)
 *  - `pending-signup` createPendingSignup → takePendingSignup (deletes)
 */

const randomHandle = () => crypto.randomBytes(24).toString("base64url");

export type PendingSignup = OAuthFlowDoc & { kind: "pending-signup" };

export async function createOAuthState(entry: { codeVerifier: string; expiresAt: Date }): Promise<string> {
	const handle = randomHandle();
	await colls.oauthFlows.insertOne({ kind: "oauth-state", _id: handle, ...entry });
	return handle;
}

/**
 * Single-use verification: removes the state and returns its verifier (a string
 * is what passport-oauth2 expects for a successful PKCE verify), or false when
 * the handle is unknown/expired (a replayed handle fails here).
 */
export async function verifyOAuthState(handle: unknown): Promise<string | false> {
	if (typeof handle !== "string") {
		return false;
	}
	const doc = await colls.oauthFlows.findOneAndDelete({ _id: handle, kind: "oauth-state" });
	if (!doc || doc.kind !== "oauth-state" || doc.expiresAt.getTime() <= Date.now()) {
		return false;
	}
	return doc.codeVerifier;
}

export async function createPendingSignup(entry: Omit<PendingSignup, "kind" | "_id">): Promise<string> {
	const ticket = randomHandle();
	await colls.oauthFlows.insertOne({ kind: "pending-signup", _id: ticket, ...entry });
	return ticket;
}

export async function takePendingSignup(ticket: string): Promise<Omit<PendingSignup, "kind" | "_id"> | undefined> {
	const doc = await colls.oauthFlows.findOneAndDelete({ _id: ticket, kind: "pending-signup" });
	if (!doc || doc.kind !== "pending-signup" || doc.expiresAt.getTime() <= Date.now()) {
		return undefined;
	}
	return doc;
}
