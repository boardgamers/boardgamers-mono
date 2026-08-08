import crypto from "node:crypto";
import type { WithId } from "mongodb";
import type { AdminTokenDoc, UserDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { isAdmin } from "./user.ts";

// Every TTL goes through this clamp — the routes cap it, and callers/tests can
// pass sub-day TTLs directly to this function.
export const MAX_ADMIN_TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;

export function generateAdminToken(): string {
	return crypto.randomBytes(32).toString("base64url");
}

export function hashAdminToken(token: string): string {
	return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createAdminToken(
	userId: AdminTokenDoc["user"],
	name: string,
	ttlMs: number,
): Promise<{ doc: WithId<AdminTokenDoc>; token: string }> {
	const token = generateAdminToken();
	const now = new Date();
	const doc = {
		user: userId,
		name,
		tokenHash: hashAdminToken(token),
		createdAt: now,
		expiresAt: new Date(now.getTime() + Math.min(ttlMs, MAX_ADMIN_TOKEN_TTL_MS)),
	};
	const { insertedId } = await colls.adminTokens.insertOne(doc);
	return { doc: { _id: insertedId, ...doc }, token };
}

export type AdminAuth = { user: WithId<UserDoc>; viaAdminToken: true };

/**
 * Resolve a raw admin token to its owning admin user. Returns null for unknown,
 * expired, or revoked tokens, or when the owner is gone or no longer admin
 * (authority is re-checked against the live user doc on every request, so
 * demoting an admin kills their tokens immediately). `lastUsedAt` is touched
 * fire-and-forget so auth latency doesn't depend on the write.
 *
 * The caller scopes WHERE the token authenticates (app.ts only invokes this for
 * requests under /api/admin) — everywhere else the credential is just a Bearer
 * string that resolves to no user, so it can't act as a session on account or
 * game routes by construction.
 */
export async function authenticateAdminToken(rawToken: string): Promise<AdminAuth | null> {
	const now = new Date();
	const adminToken = await colls.adminTokens.findOneAndUpdate(
		{ tokenHash: hashAdminToken(rawToken), expiresAt: { $gt: now }, revokedAt: { $exists: false } },
		{ $set: { lastUsedAt: now } },
	);
	if (!adminToken) {
		return null;
	}

	const user = await colls.users.findOne({ _id: adminToken.user });
	if (!user || !isAdmin(user)) {
		return null;
	}

	return { user, viaAdminToken: true };
}
