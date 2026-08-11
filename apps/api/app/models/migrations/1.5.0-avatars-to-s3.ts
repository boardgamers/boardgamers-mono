import { type Binary } from "mongodb";
import { colls } from "../../config/db.ts";
import { putAvatar, s3Enabled } from "../../services/s3.ts";
import type { Migration } from "./index.ts";

// Copies uploaded user avatars from the mongo `images` collection to S3
// (avatars/<userId>/<size>.webp) and marks each doc `s3: true`, which flips the
// avatar GET routes to public-URL redirects. The mongo blobs are NOT deleted —
// they stay as the serving fallback / rollback path.
//
// Idempotent: docs already flagged (by a previous run or by the upload route's
// dual-write) are skipped. No-op when S3 isn't configured — the version bump
// still lands, so enabling S3 later only serves NEW uploads from S3 until the
// backfill is re-run by hand (fine: mongo keeps serving either way).
const CONCURRENCY = 5;
const BATCH_SIZE = 100;

export const migration: Migration = {
	async up() {
		if (!s3Enabled()) {
			console.log("avatars-to-s3: S3 not configured, skipping (mongo keeps serving avatars)");
			return;
		}

		let migrated = 0;
		// Batch + no cursor timeout: the full image set can take a while, and a
		// slow run must not die on cursor timeout mid-migration.
		for await (const doc of colls.images
			.find({ refType: "User", key: "avatar", s3: { $ne: true } })
			.batchSize(BATCH_SIZE)) {
			let ok = true;
			const entries = Object.entries(doc.images);
			for (let i = 0; i < entries.length; i += CONCURRENCY) {
				const results = await Promise.all(
					entries.slice(i, i + CONCURRENCY).map(([size, data]) => {
						// Unflagged docs always hold the blob (S3-only uploads are
						// flagged at upload time and never match this query) — the
						// guard is just for the type.
						if (!data.raw) {
							return false;
						}
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the driver returns BSON Binary, which the Buffer type doesn't cover
						const raw = Buffer.isBuffer(data.raw) ? data.raw : Buffer.from((data.raw as unknown as Binary).buffer);
						return putAvatar(doc.ref.toHexString(), size, raw);
					}),
				);
				ok = ok && results.every(Boolean);
			}
			if (ok) {
				await colls.images.updateOne({ _id: doc._id }, { $set: { s3: true } });
				migrated++;
			} else {
				console.warn(`avatars-to-s3: failed to copy all sizes for user ${doc.ref.toHexString()}, left unmigrated`);
			}
		}
		console.log(`avatars-to-s3: migrated ${migrated} avatar(s) to S3 (mongo blobs kept)`);
	},
};
