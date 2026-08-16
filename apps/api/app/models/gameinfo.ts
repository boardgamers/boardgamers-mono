import type { GameInfoDoc, GameMetadataDoc, GameVersionDoc } from "@bgs/models";
import { colls } from "../config/db.ts";

/**
 * Merge a version doc with its game's metadata doc into the `GameInfo` shape the
 * API serves. `meta` (version-scoped access/bots) and `viewer`/`engine` come from
 * the version doc; `label`/`description`/`players`/options… come from the single
 * per-game metadata doc (#298).
 *
 * Deploy-before-migration tolerant: migrations run on api-cron boot *after* code
 * ships, so there is a window where `gameMetadatas` doesn't exist yet and the
 * version doc still carries the game-level fields. Fall back to a bare version doc
 * then — its shape is a superset of `GameInfo` until the migration strips it.
 *
 * Assumption: a non-null `metadata` doc is always COMPLETE. `gameMetadatas` docs
 * are only ever written whole — by the migration, or by the admin metadata route
 * outside a deploy (nothing writes `gamemetadatas` during the deploy window, so a
 * partial doc can't pre-exist the migration). We therefore spread the metadata
 * fields directly rather than merging per-field.
 */
export function mergeGameInfo(version: GameVersionDoc | null, metadata: GameMetadataDoc | null): GameInfoDoc | null {
	if (!version) {
		return null;
	}
	if (!metadata) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pre-migration fallback: the version doc still carries the game-level fields
		return version as GameInfoDoc;
	}
	const { _id: _metadataId, ...metadataFields } = metadata;
	return { ...version, ...metadataFields };
}

export async function findGameInfoWithVersion(game: string, version: number | "latest"): Promise<GameInfoDoc | null> {
	// The metadata read only depends on `game`, so both queries run concurrently.
	const [versionDoc, metadata] = await Promise.all([
		version === "latest"
			? colls.gameInfos.findOne({ "_id.game": game }, { sort: { "_id.version": -1 } })
			: colls.gameInfos.findOne({ _id: { game, version } }),
		colls.gameMetadatas.findOne({ _id: game }),
	]);
	return mergeGameInfo(versionDoc, metadata);
}
