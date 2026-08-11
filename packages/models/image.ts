import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zDate, zObjectId } from "./helpers.ts";

export const imageSchema = z.object({
	_id: zObjectId().optional(),
	formats: z.array(z.string()),
	images: z.record(
		z.string(),
		z.object({
			mime: z.string(),
			// The webp bytes. Absent when the avatar lives in S3 only (uploads
			// after the S3 migration) — then `s3` is true and the other fields
			// are the metadata record (etag/index) for it.
			raw: z.instanceof(Buffer).optional(),
			size: z.number(),
			// sha256 of `raw` (hex), computed once at upload. Used as the avatar ETag
			// so the api doesn't re-hash the whole blob on every request. Optional:
			// avatars uploaded before this field was added don't have it (the route
			// falls back to hashing on the fly).
			hash: z.string().optional(),
		}),
	),
	key: z.string(),
	ref: zObjectId(),
	refType: z.literal("User"),
	// Set once every size's blob has been copied to S3 (avatars/<ref>/<size>.webp)
	// — by the upload route or the boot migration. The avatar GET routes 302 to
	// the public S3 object URL only when this is true; absent/false means serve
	// from mongo. Pre-#224 mongo blobs are kept as fallback and never deleted.
	s3: z.boolean().optional(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type ImageDoc = z.output<typeof imageSchema>;

export const IMAGES_COLLECTION = "images";

export const imageIndexes: IndexDescription[] = [
	// api: avatar/image lookup per user
	{ key: { ref: 1, key: 1 } },
];
