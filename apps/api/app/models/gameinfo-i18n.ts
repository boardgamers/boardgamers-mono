// Per-language overlay for game metadata text (#306). Language negotiation
// itself is shared with the other #306 slices: `negotiateContentLanguage` in
// app/services/language.ts (lang cookie → first Accept-Language base subtag →
// "en") — this module only applies the resolved language to a merged game-info.
import { createHash } from "node:crypto";
import { locales } from "@bgs/models";
import type { GameInfoOption, GameMetadataDoc, GameOptionTranslations, GameVersionDoc } from "@bgs/models";
import type { Context } from "koa";
import { negotiateContentLanguage } from "../services/language.ts";

/**
 * The languages game metadata (and option labels) translate into: base
 * subtags of every supported UI locale except English (the source). Shared by
 * the bulk metadata job, the per-game translate-all, the admin meta GET's
 * `translationNeeds`, and the dashboard's metadata grid columns.
 */
export function metadataTargetLangs(): string[] {
	return [...new Set(locales.map((l) => l.split("-")[0]))].filter((l) => l !== "en");
}

/**
 * The request's preferred base language subtag (see services/language.ts).
 * Game-metadata translation keys are base subtags (`gameMetadataTranslationsSchema`),
 * so unlike content pages the region is stripped here (pt-BR → pt).
 */
export function requestLanguage(ctx: Context): string {
	return negotiateContentLanguage(ctx).split("-")[0];
}

type Translations = GameMetadataDoc["translations"];

/**
 * The base (English) description/rules/credits that have a non-empty string —
 * the source the metadata translate endpoints work from, and the input to
 * `metadataSourceHash`. Typed so callers don't need a cast.
 */
export function metadataSourceStrings(doc: {
	description?: string;
	rules?: string;
	credits?: string;
}): Record<string, string> {
	const source: Record<string, string> = {};
	for (const field of ["description", "rules", "credits"] as const) {
		const value = doc[field];
		if (typeof value === "string" && value) {
			source[field] = value;
		}
	}
	return source;
}

/**
 * Content hash of the translation source text, stored as
 * `translations.<lang>.translatedFrom.hash` when an overlay is written. The
 * overlay is OUTDATED when the stored hash differs from the current source's.
 * A hash (not a timestamp) on purpose: the doc's `updatedAt` bumps on every
 * write — likes ($inc likeCount), status recomputes, the overlay write itself —
 * so a timestamp comparison would self-invalidate and decay to noise, while a
 * content hash only moves when the source TEXT changes (and an
 * edit-then-revert correctly reads fresh again). Key order is deterministic:
 * `metadataSourceStrings` inserts in a fixed field order.
 */
export function metadataSourceHash(source: Record<string, string>): string {
	return createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
}

/**
 * Whether a (game, lang) pair is worth a (paid) translation. Shared by the
 * bulk metadata endpoint and the per-game translate-all so the two paths never
 * diverge: a pair needs translation when the game has source text and the
 * overlay doesn't carry a `translatedFrom.hash` stamp matching the current
 * source — i.e. it is MISSING, OUTDATED (stale stamp), or a legacy stamp-less
 * overlay ("unknown" on the dashboard). Unknown overlays are unverifiable, so
 * they count too: worst case a fine translation is re-paid once, and the new
 * write stamps a hash, making it a one-time cost.
 */
export function metadataNeedsTranslation(
	doc: Pick<GameMetadataDoc, "description" | "rules" | "credits" | "translations">,
	targetLang: string,
): boolean {
	const source = metadataSourceStrings(doc);
	if (Object.keys(source).length === 0) {
		return false;
	}
	return doc.translations?.[targetLang]?.translatedFrom?.hash !== metadataSourceHash(source);
}

/**
 * Overlay `translations[lang]` onto a merged game-info-like doc, per field with
 * English/base fallback: description/rules/credits resolve to
 * `translations[lang]?.<field> ?? <base field>`. Returns the doc unchanged when
 * `lang` is "en" or no translation exists for `lang` (byte-identical to the
 * pre-#306 response). `doc` may be null (pass-through for merge results).
 */
export function applyGameInfoTranslation<T extends Record<string, unknown> | null>(
	doc: T,
	translations: Translations,
	lang: string,
): T {
	if (!doc || lang === "en" || !translations) {
		return doc;
	}
	const overlay = translations[lang];
	if (!overlay) {
		return doc;
	}
	for (const field of ["description", "rules", "credits"] as const) {
		const translated = overlay[field];
		if (translated !== undefined) {
			doc[field] = translated;
		}
	}
	return doc;
}

// -- Option / setting / preference / expansion labels (#306 follow-up) ---------

// The version-doc arrays whose `label` strings are user-facing and translatable.
// `expansions` is the same {name, label} shape minus items/type.
export const OPTION_GROUPS = ["options", "settings", "preferences", "expansions"] as const;

type OptionGroup = (typeof OPTION_GROUPS)[number];

// The subset of a version doc the option-label translation machinery reads.
export type OptionSourceDoc = Partial<
	Pick<GameVersionDoc, "options" | "settings" | "preferences" | "expansions">
> | null;

/**
 * The overlay key of one option-like entry: "options.<name>",
 * "options.<name>.items.<itemName>", "settings.<name>", "preferences.<name>",
 * "expansions.<name>". NAMES key the overlay (not array indices): they are the
 * stable engine identifiers that survive version uploads, while positions and
 * labels move.
 */
function optionKey(group: OptionGroup, name: string, itemName?: string): string {
	return itemName === undefined ? `${group}.${name}` : `${group}.${name}.items.${itemName}`;
}

/**
 * Every translatable label of a version doc's engine-defined configuration,
 * keyed by its stable overlay key (see `optionKey`). `type: "hidden"` options
 * never render, so their labels (and items) are excluded — no paid translation
 * for invisible strings. Nameless or label-less entries are skipped: without a
 * stable name there is no overlay key, without a label nothing to translate.
 */
export function optionSourceStrings(version: OptionSourceDoc): Record<string, string> {
	const source: Record<string, string> = {};
	if (!version) {
		return source;
	}
	for (const group of OPTION_GROUPS) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- expansions is a label/name subset of GameInfoOption
		const entries = (version[group] ?? []) as Partial<GameInfoOption>[];
		for (const entry of entries) {
			if (!entry.name || ("type" in entry && entry.type === "hidden")) {
				continue;
			}
			if (entry.label) {
				source[optionKey(group, entry.name)] = entry.label;
			}
			for (const item of entry.items ?? []) {
				if (item.name && item.label) {
					source[optionKey(group, entry.name, item.name)] = item.label;
				}
			}
		}
	}
	return source;
}

/**
 * Content hash of ONE English label, stored per-entry as
 * `optionTranslations.<lang>.<key>.translatedFrom.hash`. Per-string (unlike the
 * metadata overlay's whole-overlay `metadataSourceHash`) because option labels
 * change independently across engine versions — a one-label tweak must not
 * flag (or re-pay) every other label of the game.
 */
export function optionLabelHash(label: string): string {
	return createHash("sha256").update(label).digest("hex").slice(0, 16);
}

type OptionOverlay = GameOptionTranslations[string] | undefined;

/**
 * The overlay keys of `source` strings that need a (paid) translation into the
 * overlay: entry missing, stale (`translatedFrom.hash` differs from the current
 * English label's), or stamp-less (unverifiable — worst case a fine translation
 * is re-paid once and comes out stamped). Same missing/outdated/unknown
 * semantics as `metadataNeedsTranslation`, applied per string.
 */
export function optionKeysNeedingTranslation(source: Record<string, string>, overlay: OptionOverlay): string[] {
	return Object.keys(source).filter((key) => overlay?.[key]?.translatedFrom?.hash !== optionLabelHash(source[key]));
}

/**
 * Serve-time application of the option-label overlay onto a merged game-info:
 * every options/settings/preferences/expansions label (and select item label)
 * resolves per string to `overlay[key].label ?? <English label>`. Entries are
 * looked up by NAME, so the overlay applies to any served version — a version
 * whose option names differ (renamed/added in a later engine version) falls
 * back to English for those strings. Stale entries are served as-is (like
 * outdated metadata overlays): a slightly-old translation beats English.
 * Arrays are rebuilt, not mutated — the caller may share them with the raw
 * version doc.
 */
export function applyGameOptionTranslations<T extends Record<string, unknown> | null>(
	doc: T,
	optionTranslations: GameMetadataDoc["optionTranslations"],
	lang: string,
): T {
	if (!doc || lang === "en" || !optionTranslations) {
		return doc;
	}
	const overlay = optionTranslations[lang];
	if (!overlay) {
		return doc;
	}
	for (const group of OPTION_GROUPS) {
		if (!Array.isArray(doc[group])) {
			continue;
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merged game-info group arrays are option-shaped
		doc[group] = (doc[group] as Partial<GameInfoOption>[]).map((entry) => {
			if (!entry.name) {
				return entry;
			}
			const items = entry.items?.map((item) => ({
				...item,
				label: overlay[optionKey(group, entry.name!, item.name)]?.label ?? item.label,
			}));
			return {
				...entry,
				...(entry.label ? { label: overlay[optionKey(group, entry.name)]?.label ?? entry.label } : {}),
				...(entry.items !== undefined && entry.items !== null ? { items } : {}),
			};
		});
	}
	return doc;
}
