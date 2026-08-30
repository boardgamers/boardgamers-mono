// Per-language overlay for changelog entries — the changelog slice of #306,
// mirroring models/gameinfo-i18n.ts (game metadata). Language negotiation is
// the shared `negotiateContentLanguage` (services/language.ts); translation
// keys are base subtags, so use `requestLanguage` (re-exported below) to
// resolve a request's language.
import { createHash } from "node:crypto";
import type { ChangelogDoc } from "@bgs/models";
import { locales } from "@bgs/models";

export { requestLanguage } from "./gameinfo-i18n.ts";

/**
 * The base (English) content/details that have a non-empty string — the
 * source the changelog translate job works from, and the input to
 * `changelogSourceHash`. `content` is required on the doc, `details` optional.
 */
export function changelogSourceStrings(doc: { content?: string; details?: string }): Record<string, string> {
	const source: Record<string, string> = {};
	for (const field of ["content", "details"] as const) {
		const value = doc[field];
		if (typeof value === "string" && value) {
			source[field] = value;
		}
	}
	return source;
}

/**
 * Content hash of the translation source text, stored as
 * `translations.<lang>.translatedFrom.hash` when an overlay is written — the
 * same scheme (and rationale) as `metadataSourceHash`: the overlay is
 * OUTDATED when the stored hash differs from the current source's, and only a
 * source TEXT change moves the hash (an edit-then-revert reads fresh again).
 * Key order is deterministic: `changelogSourceStrings` inserts in a fixed
 * field order.
 */
export function changelogSourceHash(source: Record<string, string>): string {
	return createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
}

/**
 * The languages changelog entries translate into: base subtags of every
 * supported UI locale except English (the source). Same target set as game
 * metadata (`metadataTargetLangs`).
 */
export function changelogTargetLangs(): string[] {
	return [...new Set(locales.map((l) => l.split("-")[0]))].filter((l) => l !== "en");
}

/**
 * Whether an (entry, lang) pair is worth a (paid) translation: no overlay
 * yet, or the overlay's stamp no longer matches the current source text
 * (OUTDATED — entries stay short-lived and cheap, so unlike the first
 * metadata cut, outdated overlays are re-translated from day one). An
 * unstamped overlay (only possible via a manual db write) is left alone
 * rather than clobbered.
 */
export function changelogNeedsTranslation(doc: ChangelogDoc, targetLang: string): boolean {
	const overlay = doc.translations?.[targetLang];
	if (!overlay) {
		return true;
	}
	const stampedHash = overlay.translatedFrom?.hash;
	return !!stampedHash && stampedHash !== changelogSourceHash(changelogSourceStrings(doc));
}

/**
 * Overlay `translations[lang]` onto a changelog entry, per field with English
 * fallback, and strip the `translations` map from the payload (public clients
 * see the pre-#306 shape, just localized). Mutates and returns `doc`.
 */
export function applyChangelogTranslation(doc: ChangelogDoc, lang: string): ChangelogDoc {
	const overlay = lang === "en" ? undefined : doc.translations?.[lang];
	if (overlay) {
		for (const field of ["content", "details"] as const) {
			const translated = overlay[field];
			if (translated !== undefined) {
				doc[field] = translated;
			}
		}
	}
	delete doc.translations;
	return doc;
}
