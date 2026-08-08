import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const adminTokenSchema = z.object({
	_id: zObjectId().optional(),
	// Owning admin. The token only authenticates while this user still has
	// authority === "admin" — checked against the live user doc on every request.
	userId: zObjectId(),
	name: z.string(),
	// sha256 hex of the raw token. The raw token is 256 bits of randomness (shown
	// once at creation, never stored), so a fast unsalted hash is safe.
	tokenHash: z.string(),
	createdAt: zDate(),
	expiresAt: zDate(),
	lastUsedAt: zDate().optional(),
	revokedAt: zDate().optional(),
});

export type AdminTokenDoc = z.output<typeof adminTokenSchema>;

/** What GET /api/admin/tokens exposes (the hash never leaves the api). */
export type AdminTokenFront = Pick<AdminTokenDoc, "name" | "createdAt" | "expiresAt" | "lastUsedAt" | "revokedAt"> & {
	_id: string;
};

export const ADMIN_TOKENS_COLLECTION = "admintokens";

export const adminTokenIndexes: IndexDescription[] = [
	// api: list an admin's own tokens
	{ key: { userId: 1 } },
	// api: auth lookup by token hash
	{ key: { tokenHash: 1 }, unique: true },
	// mongo: hard-delete tokens a grace period after expiry (auth never relies on
	// this — expiry is always checked in code; it just bounds collection size)
	{ key: { expiresAt: 1 }, expireAfterSeconds: 30 * 24 * 3600 },
];
