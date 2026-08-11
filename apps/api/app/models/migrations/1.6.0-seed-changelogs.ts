import { seedChangelogsFromAnnouncement } from "../changelogs.ts";
import type { Migration } from "./index.ts";

// Backfills the new changelogs collection (#184) from the legacy
// settings.Announcement blob ("last 4 changes" hand-joined with <br>), which it
// splits into one entry per change. The blob itself is kept in place:
// GET /api/site/announcement still falls back to it when no entry exists.
//
// Idempotent / seed-once: the collection is only touched while empty. The site
// route lazily runs the same seeding on first read, so by the time this
// migration executes on a live deploy the work is usually already done and this
// is a no-op (the empty check makes the race between the two safe).
export const migration: Migration = {
	async up() {
		const seeded = await seedChangelogsFromAnnouncement();
		console.log(`seed-changelogs: seeded ${seeded} entr${seeded === 1 ? "y" : "ies"} from the announcement`);
	},
};
