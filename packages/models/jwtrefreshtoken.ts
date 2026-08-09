import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const jwtRefreshTokenSchema = z.object({
	_id: zObjectId().optional(),
	user: zObjectId(),
	// sha256 hex of the raw refresh code (the session-cookie credential). The raw
	// code is 256 bits of randomness, so a fast unsalted hash is safe. Absent only on
	// legacy docs still holding the plaintext `code` — a db read must not hand out
	// live sessions (issue #164, same pattern as admintoken.ts).
	codeHash: z.string().optional(),
	// Legacy plaintext code — being phased out (migration 1.4.0 + rehash-on-lookup).
	code: z.string().optional(),
	// How the session was opened: "password", a social provider ("google" | "facebook" |
	// "discord"), or "admin" (impersonation). Missing on tokens created before the field
	// existed — aggregate those as "unknown".
	loginMethod: z.string().optional(),
	createdAt: zDate(),
	updatedAt: zDate().optional(),
});

export type JwtRefreshTokenDoc = z.output<typeof jwtRefreshTokenSchema>;

export const JWT_REFRESH_TOKENS_COLLECTION = "jwtrefreshtokens";

export const jwtRefreshTokenIndexes: IndexDescription[] = [
	// api: lookup tokens by user
	{ key: { user: 1 } },
	// api: unique plaintext refresh code (legacy — migration 1.4.0 drops this index).
	// Sparse so hash-only docs (which have no `code`) don't collide on a null value.
	{ key: { code: 1 }, unique: true, sparse: true },
	// api: auth lookup by refresh-code hash. Sparse so legacy docs (plaintext
	// `code`, no `codeHash`) don't collide on the missing field.
	{ key: { codeHash: 1 }, unique: true, sparse: true },
	// api: auto-expire after 120 days
	{ key: { createdAt: 1 }, expireAfterSeconds: 120 * 24 * 3600 },
];
