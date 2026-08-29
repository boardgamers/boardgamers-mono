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

// Only `user` is read — accept a bare reference, not a full JwtRefreshTokenDoc
// (callers mint from a just-created session that has no code/codeHash yet).
export async function createAccessToken(
	token: Pick<JwtRefreshTokenDoc, "user">,
	scopes: string[] | undefined,
	isAdmin: boolean,
) {
	const user = await colls.users.findOne({ _id: token.user });
	if (!user) {
		throw new Error(`User not found for refresh token: ${token.user.toString()}`);
	}
	const options = { expiresIn: accessTokenDuration() / 1000, algorithm: env.jwt.algorithm };
	return jwt.sign({ userId: user._id, scopes: scopes ?? ["all"], isAdmin }, env.jwt.keys.private, options);
}

export function generateRefreshCode() {
	// 256 bits of randomness — the credential is unguessable, so storing only its
	// sha256 (unsalted, fast) is safe.
	return crypto.randomBytes(32).toString("base64");
}

// The raw code is a 256-bit-random session credential (never stored), so a fast
// unsalted hash is safe — same pattern as admintokens.ts.
export function hashRefreshCode(code: string): string {
	return crypto.createHash("sha256").update(code).digest("hex");
}

export async function lookupRefreshToken(code: string) {
	return colls.jwtRefreshTokens.findOne({ codeHash: hashRefreshCode(code) });
}

/**
 * Single-use consume: atomically removes the session and returns it, or null when
 * the code is unknown. findOneAndDelete (not findOne → deleteOne) so concurrent
 * consumers can't both pass the lookup before either delete lands — the same
 * single-use pattern as the OAuth flow store (oauthflows.ts).
 */
export async function takeRefreshToken(code: string) {
	return colls.jwtRefreshTokens.findOneAndDelete({ codeHash: hashRefreshCode(code) });
}

export async function revokeRefreshToken(code: string) {
	await colls.jwtRefreshTokens.deleteOne({ codeHash: hashRefreshCode(code) });
}
