import { colls } from "../../config/db.ts";
import { deriveGameMetaStatus } from "../../services/gameinfo.ts";
import type { Migration } from "./index.ts";

// Introduces the "beta" lifecycle status (#340 follow-up): a game whose versions
// are all non-public keeps its place on the requests page until it is publicly
// released, instead of vanishing the moment the first version is uploaded.
// Re-derives the status of every game that has at least one version doc:
// nothing public → "beta", a public non-archived version → status cleared
// (absent = implemented; in particular the "implemented" marker the pre-beta
// upsert stamped on ex-requests is normalized away). Games without any version
// doc keep their status (a plain request stays "requested"). Idempotent: the
// status is a pure function of the version docs, so a re-run re-stamps the same
// values.
//
// Private implementations are opted out of the requests page via the
// admin-managed `unlisted` flag (deriveGameMetaStatus pins them to
// "implemented"): the migration seeds it for the ones known at migration time.
const UNLISTED_GAMES = ["clash"];

export const migration: Migration = {
	async up() {
		const gameIds = await colls.gameInfos.distinct("_id.game");

		// Seed the opt-out first so the derive below pins these to "implemented".
		const { modifiedCount: unlisted } = await colls.gameMetadatas.updateMany(
			{ _id: { $in: UNLISTED_GAMES }, unlisted: { $ne: true } },
			{ $set: { unlisted: true } },
		);

		let beta = 0;
		let cleared = 0;
		for (const game of gameIds) {
			const status = await deriveGameMetaStatus(game);
			if (status) {
				const { modifiedCount } = await colls.gameMetadatas.updateOne({ _id: game }, { $set: { status } });
				beta += modifiedCount;
			} else {
				const { modifiedCount } = await colls.gameMetadatas.updateOne(
					{ _id: game, status: { $exists: true } },
					{ $unset: { status: true } },
				);
				cleared += modifiedCount;
			}
		}

		console.log(
			`beta-game-status: stamped "beta" on ${beta} game(s), cleared the status on ${cleared} game(s), unlisted ${unlisted} private game(s)`,
		);
	},
};
