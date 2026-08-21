import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// Pre-#382 create routes never stamped `createdAt` on feedback requests
// (`feedbackRequests`, ObjectId ids) or whole-game requests (`gameMetadatas`
// with status "requested", slug-string ids), so the like-tie listing sort had
// nothing to compare. Backfill from the `_id`'s embedded ObjectId timestamp
// where there is one; requested-game docs predate the field entirely and get
// the migration date (relative order between them is unrecoverable).

export const migration: Migration = {
	async up() {
		let backfilled = 0;

		const requests = await colls.feedbackRequests
			.find({ createdAt: { $exists: false } }, { projection: { _id: 1 } })
			.toArray();
		for (const request of requests) {
			const { matchedCount } = await colls.feedbackRequests.updateOne(
				{ _id: request._id, createdAt: { $exists: false } },
				{ $set: { createdAt: request._id.getTimestamp() } },
			);
			backfilled += matchedCount;
		}

		const { modifiedCount } = await colls.gameMetadatas.updateMany(
			{ status: "requested", createdAt: { $exists: false } },
			{ $set: { createdAt: new Date() } },
		);

		console.log(
			`backfill-request-created-at: stamped createdAt on ${backfilled} feedback request(s), ${modifiedCount} requested game(s)`,
		);
	},
};
