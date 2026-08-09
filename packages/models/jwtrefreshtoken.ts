import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const jwtRefreshTokenSchema = z.object({
	_id: zObjectId().optional(),
	user: zObjectId(),
	// How the session was opened: "password", a social provider ("google" | "facebook" |
	// "discord"), or "admin" (impersonation). Missing on tokens created before the field
	// existed — aggregate those as "unknown".
	loginMethod: z.string().optional(),
	createdAt: zDate(),
	updatedAt: zDate().optional(),
	// sha256 hex of the raw refresh code (the session-cookie credential). The raw
	// code is 256 bits of randomness, so a fast unsalted hash is safe (issue #164,
	// same pattern as admintoken.ts); min(1) rejects empty-string "hashes".
	codeHash: z.string().min(1),
});

export type JwtRefreshTokenDoc = z.output<typeof jwtRefreshTokenSchema>;

export const JWT_REFRESH_TOKENS_COLLECTION = "jwtrefreshtokens";

export const jwtRefreshTokenIndexes: IndexDescription[] = [
	// api: lookup tokens by user
	{ key: { user: 1 } },
	// api: auth lookup by refresh-code hash
	{ key: { codeHash: 1 }, unique: true },
	// api: auto-expire after 120 days
	{ key: { createdAt: 1 }, expireAfterSeconds: 120 * 24 * 3600 },
];
