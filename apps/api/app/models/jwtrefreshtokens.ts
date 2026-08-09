import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { JwtRefreshTokenDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { env } from "../config/index.ts";

export const accessTokenPayloadSchema = z.object({
	userId: z.string(),
	scopes: z.array(z.string()),
});

export function accessTokenDuration() {
	return 3600 * 1000;
}

export async function createAccessToken(token: JwtRefreshTokenDoc, scopes: string[] | undefined, isAdmin: boolean) {
	const user = await colls.users.findOne({ _id: token.user });
	if (!user) {
		throw new Error(`User not found for refresh token: ${token.user.toString()}`);
	}
	const options = { expiresIn: accessTokenDuration() / 1000, algorithm: env.jwt.algorithm };
	return jwt.sign({ userId: user._id, scopes: scopes ?? ["all"], isAdmin }, env.jwt.keys.private, options);
}

export function generateRefreshCode() {
	return crypto.randomBytes(15).toString("base64");
}

// The raw code is a 256-bit-random session credential (never stored), so a fast
// unsalted hash is safe — same pattern as admintokens.ts.
export function hashRefreshCode(code: string): string {
	return crypto.createHash("sha256").update(code).digest("hex");
}

export function refreshCodeIndexes(code: string) {
	return [{ code }, { codeHash: hashRefreshCode(code) }];
}

/**
 * Resolve a raw refresh code to its token doc. Accepts legacy plaintext-stored
 * codes (created before codes were hashed) and rehashes them in place, so old
 * sessions keep working without waiting for migration 1.4.0.
 */
export async function lookupRefreshToken(code: string) {
	const rt = await colls.jwtRefreshTokens.findOne({ $or: refreshCodeIndexes(code) });
	if (rt?.code) {
		colls.jwtRefreshTokens
			.updateOne({ _id: rt._id }, { $set: { codeHash: rt.codeHash ?? hashRefreshCode(rt.code) }, $unset: { code: "" } })
			.catch(() => {});
	}
	return rt;
}

/** Revoke a session by its raw code (handles both hashed and legacy plaintext storage). */
export async function revokeRefreshToken(code: string) {
	await colls.jwtRefreshTokens.deleteOne({ $or: refreshCodeIndexes(code) });
}
