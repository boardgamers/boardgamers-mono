import type { AnyBulkWriteOperation } from "mongodb";
import type { JwtRefreshTokenDoc, UserDoc } from "@bgs/models";
import { JWT_REFRESH_TOKENS_COLLECTION } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import { hashRefreshCode } from "../jwtrefreshtokens.ts";
import { hashUserSecret, isSha256Hex } from "../user.ts";
import type { Migration } from "./index.ts";

// Refresh-token codes (the session-cookie credential) plus the single-use emailed
// secrets on the user doc (security.confirmKey, security.reset.key) were stored in
// plaintext — a db read/leak would hand out live sessions and working
// confirm/reset links (#164). Hash every existing plaintext value in place, then
// swap the unique refresh-token index from `code` to `codeHash`.
// lookupRefreshToken() and the confirm/reset validators also accept the legacy
// plaintext at rest, so this is the batch cleanup (and the only place the legacy
// `code_1` index gets dropped). Docs are streamed (cursor) and written in batches
// — no whole-collection toArray() on a large prod db.
const BATCH_SIZE = 1000;

export const migration: Migration = {
	async up() {
		// Legacy docs are the only ones carrying `code`, so every doc matched here is
		// plaintext by construction — no already-hashed guard needed on this pass.
		let ops: AnyBulkWriteOperation<JwtRefreshTokenDoc>[] = [];
		for await (const token of colls.jwtRefreshTokens.find({ code: { $exists: true } })) {
			if (!token.code) {
				continue;
			}
			ops.push({
				updateOne: {
					filter: { _id: token._id },
					update: { $set: { codeHash: token.codeHash ?? hashRefreshCode(token.code) }, $unset: { code: "" } },
				},
			});
			if (ops.length >= BATCH_SIZE) {
				await colls.jwtRefreshTokens.bulkWrite(ops);
				ops = [];
			}
		}
		if (ops.length > 0) {
			await colls.jwtRefreshTokens.bulkWrite(ops);
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

		const collection = db().collection(JWT_REFRESH_TOKENS_COLLECTION);
		const indexes = await collection.indexes();
		if (indexes.some((index) => index.name === "code_1")) {
			await collection.dropIndex("code_1");
		}
	},
};
