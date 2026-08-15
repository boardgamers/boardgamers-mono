import { GAME_METADATA_FIELDS } from "@bgs/models";
import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// Splits the game-level fields that were duplicated onto every `gameInfos`
// version doc into a single `gameMetadatas` doc per game (#298). The version docs
// keep the per-version fields (viewer/engine/meta/preferences/settings/options/
// factions); the metadata doc takes the identity fields (label/alias/description/
// rules/links/players/expansions).
//
// Backfill is `$setOnInsert` from the game's max-version doc (the one the UI
// renders). This is safe because `gameMetadatas` docs are only ever written
// COMPLETE — by this migration, or by the admin metadata route outside a deploy
// (nothing writes `gamemetadatas` during the deploy window, so a partial doc
// can't pre-exist the migration). `$setOnInsert` means a re-run, or a doc already
// written complete by the admin route, is left untouched — and `likeCount` (not
// in GAME_METADATA_FIELDS) is never touched either way. The `$unset` of the
// game-level fields off every version doc is a no-op once they're gone.

export const migration: Migration = {
	async up() {
		// Latest version doc per game (highest `_id.version`), the same pick the UI
		// reads ("latest"). Use an aggregation so we don't fan out per game.
		const latest = await colls.gameInfos
			.aggregate<{ _id: string; doc: Record<string, unknown> & { _id: { game: string; version: number } } }>([
				{ $sort: { "_id.game": 1, "_id.version": -1 } },
				{ $group: { _id: "$_id.game", doc: { $first: "$$ROOT" } } },
			])
			.toArray();

		let metadataUpserts = 0;
		for (const { doc } of latest) {
			const metadata: Record<string, unknown> = { _id: doc._id.game };
			for (const field of GAME_METADATA_FIELDS) {
				if (doc[field] !== undefined) {
					metadata[field] = doc[field];
				}
			}
			const result = await colls.gameMetadatas.updateOne(
				{ _id: doc._id.game },
				{ $setOnInsert: metadata },
				{ upsert: true },
			);
			if (result.upsertedCount > 0) {
				metadataUpserts++;
			}
		}

		const unset: Record<string, ""> = {};
		for (const field of GAME_METADATA_FIELDS) {
			unset[field] = "";
		}
		const { modifiedCount } = await colls.gameInfos.updateMany({}, { $unset: unset });

		console.log(
			`game-metadata-split: created ${metadataUpserts} gameMetadatas doc(s), stripped game-level fields from ${modifiedCount} version doc(s)`,
		);
	},
};
