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
// Exemption: some beta-only games are PRIVATE implementations, not public betas
// — they must not surface on the requests page (clash, a private implem, at
// migration time). They are stamped "implemented" instead, and the exemption is
// re-applied on every run so the list stays authoritative (an upsert re-derive
// would otherwise flip them back to "beta"). Remove a game from the list when
// it actually goes into public beta.
const BETA_EXEMPT_GAMES = ["clash"];

export const migration: Migration = {
	async up() {
		const gameIds = await colls.gameInfos.distinct("_id.game");

		let beta = 0;
		let cleared = 0;
		for (const game of gameIds) {
			if (BETA_EXEMPT_GAMES.includes(game)) {
				continue;
			}
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

		const { modifiedCount: exempted } = await colls.gameMetadatas.updateMany(
			{ _id: { $in: BETA_EXEMPT_GAMES }, status: { $ne: "implemented" } },
			{ $set: { status: "implemented" } },
		);

		console.log(
			`beta-game-status: stamped "beta" on ${beta} game(s), cleared the status on ${cleared} game(s), exempted ${exempted} private game(s)`,
		);
	},
};
