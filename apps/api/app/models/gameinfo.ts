import type { GameInfoDoc, GameMetadataDoc, GameVersionDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { applyGameInfoTranslation } from "./gameinfo-i18n.ts";

/**
 * Merge a version doc with its game's metadata doc into the `GameInfo` shape the
 * API serves. `public`/`meta` (version-scoped flags) and `viewer`/`engine` come from
 * the version doc; `label`/`description`/`players`/options… come from the single
 * per-game metadata doc (#298).
 *
 * Assumption: a non-null `metadata` doc is always COMPLETE. `gameMetadatas` docs
 * are only ever written whole — by the migration, or by the admin metadata route.
 * We therefore spread the metadata fields directly rather than merging per-field.
 *
 * `lang` (#306): when given (a base subtag like "de"), the translatable
 * description/rules/credits fields resolve to `metadata.translations[lang]`
 * with per-field fallback to the English/base text. Omitted (or "en"), the
 * merge is byte-identical to the pre-#306 behavior.
 */
export function mergeGameInfo(
	version: GameVersionDoc | null,
	metadata: GameMetadataDoc | null,
	lang?: string,
): GameInfoDoc | null {
	if (!version) {
		return null;
	}
	if (!metadata) {
		// Metadata-less version docs no longer occur post-migration-1.8.0 (every
		// write path upserts the metadata doc alongside); serve the bare version
		// doc rather than 404 if one is ever deleted out from under a game.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a bare version doc is a valid (metadata-less) GameInfo
		return version as GameInfoDoc;
	}
	const { _id: _metadataId, translations, ...metadataFields } = metadata;
	const merged: GameInfoDoc = { ...version, ...metadataFields };
	// `translations` is storage, not response shape: the merged doc serves the
	// RESOLVED text in the regular description/rules/credits slots (#306).
	return lang ? applyGameInfoTranslation(merged, translations, lang) : merged;
}

export async function findGameInfoWithVersion(
	game: string,
	version: number | "latest",
	lang?: string,
): Promise<GameInfoDoc | null> {
	// The metadata read only depends on `game`, so both queries run concurrently.
	const [versionDoc, metadata] = await Promise.all([
		version === "latest"
			? colls.gameInfos.findOne({ "_id.game": game }, { sort: { "_id.version": -1 } })
			: colls.gameInfos.findOne({ _id: { game, version } }),
		colls.gameMetadatas.findOne({ _id: game }),
	]);
	return mergeGameInfo(versionDoc, metadata, lang);
}
