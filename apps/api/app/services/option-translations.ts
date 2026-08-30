import type { GameMetadataDoc, GameOptionTranslations, GameVersionDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import {
	metadataNeedsTranslation,
	optionKeysNeedingTranslation,
	optionLabelHash,
	type OptionSourceDoc,
} from "../models/gameinfo-i18n.ts";
import { translateLabels } from "./translate.ts";

// Option-label translation orchestration (#306 follow-up): which version doc
// the English labels are read from, the combined needs-translation predicate
// shared by the bulk job / per-game translate routes / dashboard, and the
// overlay write (translate needed strings, stamp per-string hashes).

const OPTION_SOURCE_PROJECTION = { _id: 1, options: 1, settings: 1, preferences: 1, expansions: 1 } as const;

/**
 * The version doc whose option labels are the TRANSLATION SOURCE for a game:
 * the latest public non-archived version (what anonymous players are served),
 * falling back to the latest non-archived version when nothing is public yet
 * (beta games get translated before release). The overlay is name-keyed, so it
 * still applies to every other served version — strings whose names don't
 * match simply fall back to English.
 */
export async function optionSourceVersion(game: string): Promise<OptionSourceDoc> {
	return colls.gameInfos.findOne<Partial<GameVersionDoc>>(
		{ "_id.game": game, "meta.archived": { $ne: true } },
		{ sort: { public: -1, "_id.version": -1 }, projection: OPTION_SOURCE_PROJECTION },
	);
}

/**
 * `optionSourceVersion` for every game at once (the dashboard overview and the
 * bulk job pair-count read the whole catalog): one aggregation, keyed by game.
 * Same pick — public versions first, then latest.
 */
export async function optionSourceVersions(): Promise<Map<string, OptionSourceDoc>> {
	const docs = await colls.gameInfos
		.aggregate<Partial<GameVersionDoc> & { _id: string }>([
			{ $match: { "meta.archived": { $ne: true } } },
			{ $sort: { public: -1, "_id.version": -1 } },
			{ $project: OPTION_SOURCE_PROJECTION },
			{
				$group: {
					_id: "$_id.game",
					options: { $first: "$options" },
					settings: { $first: "$settings" },
					preferences: { $first: "$preferences" },
					expansions: { $first: "$expansions" },
				},
			},
		])
		.toArray();
	return new Map(docs.map((doc) => [doc._id, doc]));
}

/**
 * Whether a (game, lang) pair needs any (paid) translation work — markdown
 * metadata (description/rules/credits, `metadataNeedsTranslation`) OR option
 * labels (per-string: missing / stale / stamp-less entries for the current
 * source labels). One predicate shared by the bulk metadata job, the per-game
 * translate-all, and the admin meta GET's `translationNeeds`, so the paths
 * never diverge.
 */
export function gameNeedsTranslation(
	doc: Pick<GameMetadataDoc, "description" | "rules" | "credits" | "translations" | "optionTranslations">,
	optionSource: Record<string, string>,
	targetLang: string,
): boolean {
	return (
		metadataNeedsTranslation(doc, targetLang) ||
		optionKeysNeedingTranslation(optionSource, doc.optionTranslations?.[targetLang]).length > 0
	);
}

export interface TranslateOptionLabelsArgs {
	game: string;
	// Display label for LLM context ("the board game …").
	gameLabel: string;
	// Current English labels, keyed by overlay key (optionSourceStrings).
	source: Record<string, string>;
	existingOverlay: GameOptionTranslations[string] | undefined;
	targetLang: string;
	// Manual single-language translate = force (re-translate every label, like
	// the markdown route overwrites); bulk paths translate only needed strings.
	force?: boolean;
}

/**
 * Translate a game's option labels into `targetLang` and persist the
 * `optionTranslations.<lang>` overlay. Only the strings that NEED work are
 * paid for (unless `force`); fresh existing entries are carried over, and the
 * overlay is rebuilt against the CURRENT source keys — entries for renamed/
 * removed options are dropped rather than accumulating forever. Every written
 * entry is stamped with the per-string source-label hash.
 */
export async function translateOptionLabels({
	game,
	gameLabel,
	source,
	existingOverlay,
	targetLang,
	force = false,
}: TranslateOptionLabelsArgs): Promise<"translated" | "skipped"> {
	const keys = force ? Object.keys(source) : optionKeysNeedingTranslation(source, existingOverlay);
	if (keys.length === 0) {
		return "skipped";
	}
	const translated = await translateLabels({
		labels: Object.fromEntries(keys.map((key) => [key, source[key]])),
		sourceLang: "en",
		targetLang,
		context: `the board game "${gameLabel}"`,
	});
	const overlay: GameOptionTranslations[string] = {};
	for (const [key, label] of Object.entries(source)) {
		if (translated[key] !== undefined) {
			overlay[key] = { label: translated[key], translatedFrom: { hash: optionLabelHash(label) } };
		} else if (existingOverlay?.[key]) {
			overlay[key] = existingOverlay[key];
		}
	}
	// Whole-language $set (never dotted per-entry paths — the keys contain
	// literal dots and must stay literal document keys).
	await colls.gameMetadatas.updateOne({ _id: game }, { $set: { [`optionTranslations.${targetLang}`]: overlay } });
	return "translated";
}
