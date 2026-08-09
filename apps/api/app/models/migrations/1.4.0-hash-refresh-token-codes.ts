import { JWT_REFRESH_TOKENS_COLLECTION } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import { hashRefreshCode } from "../jwtrefreshtokens.ts";
import { hashUserSecret } from "../user.ts";
import type { Migration } from "./index.ts";

// Refresh-token codes (the session-cookie credential) plus the single-use emailed
// secrets on the user doc (security.confirmKey, security.reset.key) were stored in
// plaintext — a db read/leak would hand out live sessions and working
// confirm/reset links (#164). Hash every existing value in place, then swap the
// unique refresh-token index from `code` to `codeHash`. lookupRefreshToken() and
// the confirm/reset validators also accept the legacy plaintext at rest, so this
// is the batch cleanup (and the only place the legacy `code_1` index gets dropped).
export const migration: Migration = {
	async up() {
		const tokens = await colls.jwtRefreshTokens.find({ code: { $exists: true } }).toArray();
		for (const token of tokens) {
			if (!token.code) {
				continue;
			}
			await colls.jwtRefreshTokens.updateOne(
				{ _id: token._id },
				{ $set: { codeHash: token.codeHash ?? hashRefreshCode(token.code) }, $unset: { code: "" } },
			);
		}

		const users = await colls.users
			.find(
				{
					$or: [
						{ "security.confirmKey": { $type: "string", $ne: "" } },
						{ "security.reset.key": { $type: "string", $ne: "" } },
					],
				},
				{ projection: { "security.confirmKey": 1, "security.reset": 1 } },
			)
			.toArray();
		for (const user of users) {
			const set: Record<string, string> = {};
			const confirmKey = user.security?.confirmKey;
			if (confirmKey) {
				set["security.confirmKey"] = hashUserSecret(confirmKey);
			}
			const resetKey = user.security?.reset?.key;
			if (resetKey) {
				set["security.reset.key"] = hashUserSecret(resetKey);
			}
			if (Object.keys(set).length > 0) {
				await colls.users.updateOne({ _id: user._id }, { $set: set });
			}
		}

		const collection = db().collection(JWT_REFRESH_TOKENS_COLLECTION);
		const indexes = await collection.indexes();
		if (indexes.some((index) => index.name === "code_1")) {
			await collection.dropIndex("code_1");
		}
	},
};
