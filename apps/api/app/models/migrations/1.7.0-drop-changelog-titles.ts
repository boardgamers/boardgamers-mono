import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// The per-entry `title` is gone: `content` (the short one-liner) is now the
// whole entry, and every seeded row was carrying the identical "Recent changes"
// heading. Drop the field so the schema's optional `title` only survives on
// untouched old dbs.
//
// Idempotent: $unset is a no-op when nothing matches, so re-running is safe.
export const migration: Migration = {
	async up() {
		const { modifiedCount } = await colls.changelogs.updateMany(
			{ title: { $exists: true } },
			{ $unset: { title: "" } },
		);
		console.log(`drop-changelog-titles: cleared title on ${modifiedCount} entries`);
	},
};
