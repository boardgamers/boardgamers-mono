import { type ChangelogDoc, SettingsKey, announcementSchema, changelogSchema } from "@bgs/models";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../config/db.ts";
import { applyChangelogTranslation } from "./changelog-i18n.ts";

// Admin create/update payload: `content` is the short one-liner (the entry itself),
// `details`/`github` are optional extras rendered on /changelog only.
export const changelogInputSchema = changelogSchema
	.pick({ content: true, details: true, github: true, published: true })
	.extend({
		content: z.string().trim().min(1).max(500),
		details: z.string().trim().min(1).optional(),
	});

// How many entries the homepage announcement box stitches together.
export const ANNOUNCEMENT_ENTRY_COUNT = 4;

// Both public listing and the announcement read newest-first. `lang` (a base
// subtag from `requestLanguage`) localizes content/details per entry with
// per-field English fallback; the `translations` map itself never leaves the
// api (public clients keep the pre-#306 payload shape).
export async function latestChangelogs(limit: number, before?: Date, lang = "en"): Promise<ChangelogDoc[]> {
	const entries = await colls.changelogs
		.find({ published: true, ...(before ? { createdAt: { $lt: before } } : {}) })
		.sort({ createdAt: -1 })
		.limit(limit)
		.toArray();
	return entries.map((entry) => applyChangelogTranslation(entry, lang));
}

// The announcement box is now a view over the changelog: the latest entries'
// one-liners, joined back together. The box header ("Recent changes") is fixed
// in the homepage markup.
export async function announcementFromChangelog(lang = "en"): Promise<{ content: string } | undefined> {
	const entries = await latestChangelogs(ANNOUNCEMENT_ENTRY_COUNT, undefined, lang);
	if (entries.length === 0) {
		return undefined;
	}
	return { content: entries.map((entry) => entry.content).join("<br>\n") };
}

// Best-effort split of the historical announcement blob ("last 4 changes" joined
// by <br>) into individual entries. Exported for tests + the 1.6.0 migration.
export function splitAnnouncementContent(content: string): string[] {
	const parts = content
		.split(/<br\s*\/?>|\n\n+/i)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return [];
	}
	// A blob that doesn't split into anything meaningful stays one entry.
	if (parts.length === 1) {
		return [content.trim()];
	}
	return parts;
}

// Reads the pre-#184 announcement blob and seeds it as changelog entries when the
// collection is still empty. Also used by migration 1.6.0.
export async function seedChangelogsFromAnnouncement(): Promise<number> {
	if ((await colls.changelogs.estimatedDocumentCount()) > 0) {
		return 0;
	}
	const announcement = announcementSchema.safeParse(
		(await colls.settings.findOne({ _id: SettingsKey.Announcement }))?.value,
	);
	if (!announcement.success || !announcement.data.content.trim()) {
		return 0;
	}

	const now = new Date();
	const parts = splitAnnouncementContent(announcement.data.content);
	const docs: ChangelogDoc[] = parts.map((part, i) => ({
		_id: new ObjectId(),
		content: part,
		published: true,
		// Keep list order stable: 1ms apart, oldest part last.
		createdAt: new Date(now.getTime() - i),
	}));
	await colls.changelogs.insertMany(docs);
	return docs.length;
}
