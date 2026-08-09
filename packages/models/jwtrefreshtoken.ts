import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// Shared fields. During the transition a doc carries either the new `codeHash`
// or the legacy plaintext `code` — never both, never neither. Modeled as a union
// (not a .refine) so the invariant also survives zodToMongoSchema into the
// Mongo $jsonSchema validator; min(1) rejects empty-string "hashes".
const jwtRefreshTokenBase = {
	_id: zObjectId().optional(),
	user: zObjectId(),
	// How the session was opened: "password", a social provider ("google" | "facebook" |
	// "discord"), or "admin" (impersonation). Missing on tokens created before the field
	// existed — aggregate those as "unknown".
	loginMethod: z.string().optional(),
	createdAt: zDate(),
	updatedAt: zDate().optional(),
};

export const jwtRefreshTokenSchema = z.union([
	z.object({
		...jwtRefreshTokenBase,
		// sha256 hex of the raw refresh code (the session-cookie credential). The raw
		// code is 256 bits of randomness, so a fast unsalted hash is safe (issue #164,
		// same pattern as admintoken.ts).
		codeHash: z.string().min(1),
		code: z.undefined().optional(),
	}),
	z.object({
		...jwtRefreshTokenBase,
		codeHash: z.undefined().optional(),
		// Legacy plaintext code — being phased out (migration 1.4.0 + rehash-on-lookup).
		code: z.string().min(1),
	}),
]);

export type JwtRefreshTokenDoc = z.output<typeof jwtRefreshTokenSchema>;

export const JWT_REFRESH_TOKENS_COLLECTION = "jwtrefreshtokens";

export const jwtRefreshTokenIndexes: IndexDescription[] = [
	// api: lookup tokens by user
	{ key: { user: 1 } },
	// api: auth lookup by refresh-code hash. Sparse so legacy docs (plaintext
	// `code`, no `codeHash`) don't collide on the missing field.
	{ key: { codeHash: 1 }, unique: true, sparse: true },
	// api: legacy plaintext-code lookup during the transition. Sparse so hash-only
	// docs (no `code`) don't collide on null. The legacy NON-sparse `code_1` can't be
	// recreated in place (same name, different options → IndexKeySpecsConflict), so
	// ensureIndexes drops it first (see ./setup.ts); this sparse replacement keeps
	// the legacy lookup indexed.
	{ key: { code: 1 }, unique: true, sparse: true },
	// api: auto-expire after 120 days
	{ key: { createdAt: 1 }, expireAfterSeconds: 120 * 24 * 3600 },
];
