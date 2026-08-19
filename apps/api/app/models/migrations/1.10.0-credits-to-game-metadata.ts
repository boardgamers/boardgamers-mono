import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// Moves the #348 per-game credits CMS pages (`pages` docs named `<game>:credits`)
// onto the game metadata doc as the `credits` markdown field (#351). Only pages
// whose game still lacks `credits` are moved, so a re-run — or a credits page
// created by pre-#351 code during the deploy window — never clobbers an edited
// field. The page doc is deleted only once the metadata update has matched.

export const migration: Migration = {
	async up() {
		const pages = await colls.pages
			.find({ "_id.name": /:credits$/, "_id.lang": "en" })
			.project({ content: 1 })
			.toArray();

		let moved = 0;
		for (const page of pages) {
			const game = page._id.name.slice(0, -":credits".length);
			const { matchedCount } = await colls.gameMetadatas.updateOne(
				{ _id: game, credits: { $exists: false } },
				{ $set: { credits: page.content } },
			);
			if (matchedCount > 0) {
				await colls.pages.deleteOne({ _id: page._id });
				moved++;
			}
		}

		console.log(`credits-to-game-metadata: moved ${moved} <game>:credits page(s) onto game metadata`);
	},
};
