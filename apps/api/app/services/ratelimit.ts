import { colls } from "../config/db.ts";

// Sliding-window attempt counter over Mongo — shared across the PM2 cluster, so
// the configured limit is the real total (an in-memory limiter would multiply
// it by the worker count and reset on every reload).
//
// One document per (bucket, key, aligned window): hits inside the window $inc
// its `count`; the first hit past the cap gets an afterCount over the limit
// (the $inc is atomic, so concurrent workers can't overshoot past `max` and
// still pass). The next window uses a fresh document — that is the reset, and
// docs self-delete via the TTL index on expiresAt.

const DUPLICATE_KEY = 11000;

function windowId(bucket: string, key: string, windowMs: number, now: number): { id: string; expiresAt: Date } {
	const windowStart = now - (now % windowMs);
	return {
		id: `${bucket}:${windowStart}:${key}`,
		expiresAt: new Date(windowStart + 2 * windowMs),
	};
}

export async function recordAttempt(
	bucket: string,
	key: string,
	limit: { windowMs: number; max: number },
	now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
	const { id, expiresAt } = windowId(bucket, key, limit.windowMs, now);

	let doc;
	try {
		// One atomic round trip: $inc initializes the field on the upsert-insert
		// branch, so the returned count always includes this hit.
		doc = await colls.authAttempts.findOneAndUpdate(
			{ _id: id },
			{ $inc: { count: 1 }, $set: { expiresAt } },
			{ upsert: true, returnDocument: "after" },
		);
	} catch (err) {
		// A racing first hit inserts the same _id between our upsert's find and
		// insert — replay as a plain $inc against the now-existing doc.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- driver errors carry `code`
		if ((err as { code?: number })?.code !== DUPLICATE_KEY) {
			throw err;
		}
		doc = await colls.authAttempts.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
	}

	const count = doc?.count ?? limit.max + 1;
	const windowStart = now - (now % limit.windowMs);
	const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + limit.windowMs - now) / 1000));
	return { allowed: count <= limit.max, retryAfterSeconds };
}
