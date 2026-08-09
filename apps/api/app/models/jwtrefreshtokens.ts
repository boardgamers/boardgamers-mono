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
	// 256 bits of randomness — the credential is unguessable, so storing only its
	// sha256 (unsalted, fast) is safe.
	return crypto.randomBytes(32).toString("base64");
}

// The raw code is a 256-bit-random session credential (never stored), so a fast
// unsalted hash is safe — same pattern as admintokens.ts.
export function hashRefreshCode(code: string): string {
	return crypto.createHash("sha256").update(code).digest("hex");
}

// Legacy codes were 15 random bytes base64-encoded (length 20). New codes are 32
// bytes (length 44) and only ever match the indexed codeHash. Gating the legacy
// `{code}` lookup on the old length keeps the hot auth path on the codeHash index
// — after migration 1.4.0 drops `code_1`, an unconditional `{code}` branch would
// collection-scan on every lookup.
const LEGACY_CODE_LENGTH = 20;

const isLegacyCode = (code: string) => code.length === LEGACY_CODE_LENGTH;

/**
 * Resolve a raw refresh code to its token doc. Accepts legacy plaintext-stored
 * codes (created before codes were hashed) and rehashes them in place, so old
 * sessions keep working without waiting for migration 1.4.0.
 */
export async function lookupRefreshToken(code: string) {
	// Indexed path first.
	const byHash = await colls.jwtRefreshTokens.findOne({ codeHash: hashRefreshCode(code) });
	if (byHash) {
		return byHash;
	}
	// Legacy fallback: only pre-#164 codes (length 20) can match a plaintext `code`.
	const rt = isLegacyCode(code) ? await colls.jwtRefreshTokens.findOne({ code }) : null;
	if (rt?.code) {
		// Fire-and-forget rehash of a legacy plaintext code — auth latency must not
		// depend on the write, and a failure just leaves the rehash to the next
		// lookup / migration 1.4.0. Never log the code itself.
		colls.jwtRefreshTokens
			.updateOne({ _id: rt._id }, { $set: { codeHash: rt.codeHash ?? hashRefreshCode(rt.code) }, $unset: { code: "" } })
			.catch((err) => console.error(`failed to rehash legacy refresh token ${rt._id.toString()}:`, err));
	}
	return rt;
}

/**
 * Revoke a session by its raw code (handles both hashed and legacy plaintext
 * storage). A single $or delete: atomic with respect to the fire-and-forget
 * rehash in lookupRefreshToken (a two-step delete could miss both shapes if the
 * doc flips from {code} to {codeHash} mid-revoke). Revokes are rare (logout /
 * signout-all), so the unindexed legacy {code} branch is fine here.
 */
export async function revokeRefreshToken(code: string) {
	await colls.jwtRefreshTokens.deleteOne({ $or: [{ codeHash: hashRefreshCode(code) }, { code }] });
}
