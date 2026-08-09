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
	// During the transition a doc carries either the new `codeHash` or the legacy
	// plaintext `code` — never both, never neither. Presence via !== undefined (not
	// truthiness) so an empty-string codeHash doesn't count as a valid hash.
}).refine((doc) => (doc.codeHash !== undefined) !== (doc.code !== undefined), {
	message: "expected exactly one of codeHash (new) or code (legacy)",
});

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
