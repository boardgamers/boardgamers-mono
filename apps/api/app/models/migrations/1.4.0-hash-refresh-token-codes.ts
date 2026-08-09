import type { AnyBulkWriteOperation } from "mongodb";
import { JWT_REFRESH_TOKENS_COLLECTION } from "@bgs/models";
import type { JwtRefreshTokenDoc, UserDoc } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import { hashRefreshCode } from "../jwtrefreshtokens.ts";
import { hashUserSecret } from "../user.ts";
import type { Migration } from "./index.ts";

// A migration is a historical artifact: it must keep compiling against the row
// shapes it operates on even after the live schema moves on. The legacy
// plaintext `code` field and the isSha256Hex helper were dropped from
// @bgs/models / user.ts once this migration had run in prod, so the migration
// carries its own copies.
type LegacyJwtRefreshTokenDoc = Omit<JwtRefreshTokenDoc, "codeHash"> & {
	codeHash?: string;
	// Pre-#164 plaintext session code, present on every doc this migration matches.
	code?: string;
};

function isSha256Hex(value: string): boolean {
	return /^[0-9a-f]{64}$/.test(value);
}

// Refresh-token codes (the session-cookie credential) plus the single-use emailed
// secrets on the user doc (security.confirmKey, security.reset.key) were stored in
// plaintext — a db read/leak would hand out live sessions and working
// confirm/reset links (#164). Hash every existing plaintext value in place.
// (The legacy `code_1` index is dropped separately, in ensureIndexes — it must go
// before createIndexes, not here.)
// Docs are streamed (cursor) and written in batches — no whole-collection
// toArray() on a large prod db.
const BATCH_SIZE = 1000;

export const migration: Migration = {
	async up() {
		// Legacy docs are the only ones carrying `code`, so every doc matched here is
		// plaintext by construction — no already-hashed guard needed on this pass.
		// Read through a legacy-typed handle: `code` is no longer on the live schema.
		const legacyTokens = db().collection<LegacyJwtRefreshTokenDoc>(JWT_REFRESH_TOKENS_COLLECTION);
		let ops: AnyBulkWriteOperation<LegacyJwtRefreshTokenDoc>[] = [];
		for await (const token of legacyTokens.find({ code: { $exists: true } })) {
			if (!token.code) {
				continue;
			}
			// Always recompute the hash from the plaintext code (present on every matched
			// doc) before unsetting it — an existing codeHash could be stale/malformed and
			// would otherwise leave the session unresolvable once `code` is gone.
			ops.push({
				updateOne: {
					filter: { _id: token._id },
					update: { $set: { codeHash: hashRefreshCode(token.code) }, $unset: { code: "" } },
				},
			});
			if (ops.length >= BATCH_SIZE) {
				await legacyTokens.bulkWrite(ops);
				ops = [];
			}
		}
		if (ops.length > 0) {
			await legacyTokens.bulkWrite(ops);
		}

		// Users created after this change deployed already store hashes — skip any
		// value that is already a sha256 hex, or it would get hashed a second time
		// and the emailed plaintext link would stop matching.
		let userOps: AnyBulkWriteOperation<UserDoc>[] = [];
		for await (const user of colls.users.find(
			{
				$or: [
					{ "security.confirmKey": { $type: "string", $ne: "" } },
					{ "security.reset.key": { $type: "string", $ne: "" } },
				],
			},
			{ projection: { "security.confirmKey": 1, "security.reset": 1 } },
		)) {
			const set: Record<string, string> = {};
			const confirmKey = user.security?.confirmKey;
			if (confirmKey && !isSha256Hex(confirmKey)) {
				set["security.confirmKey"] = hashUserSecret(confirmKey);
			}
			const resetKey = user.security?.reset?.key;
			if (resetKey && !isSha256Hex(resetKey)) {
				set["security.reset.key"] = hashUserSecret(resetKey);
			}
			if (Object.keys(set).length === 0) {
				continue;
			}
			userOps.push({ updateOne: { filter: { _id: user._id }, update: { $set: set } } });
			if (userOps.length >= BATCH_SIZE) {
				await colls.users.bulkWrite(userOps);
				userOps = [];
			}
		}
		if (userOps.length > 0) {
			await colls.users.bulkWrite(userOps);
		}
	},
};
