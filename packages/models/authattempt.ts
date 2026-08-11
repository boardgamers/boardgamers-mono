import { z } from "zod";
import type { IndexDescription } from "mongodb";

/**
 * Sliding-window attempt counter for the public auth endpoints that reveal
 * account existence (login / forget / reset / confirm — issue #195). One doc
 * per (bucket, key) pair where the key is the client IP or the target email.
 *
 * Counters live in Mongo (not in-process) because the api runs as a PM2
 * cluster — a per-process limiter would multiply the effective limit by the
 * worker count and reset on every reload. Not personal data of note (IPs
 * already land in access logs / apierrors), and everything self-expires via
 * the TTL index below.
 */
export const authAttemptSchema = z.object({
	/** `${bucket}:${windowStartMs}` — window start aligns with the bucket's window size. */
	_id: z.string(),
	count: z.number().int(),
	/** Set a window past its start so the doc self-deletes well after its window closed. */
	expiresAt: z.date(),
});

export type AuthAttemptDoc = z.output<typeof authAttemptSchema>;

export const AUTH_ATTEMPTS_COLLECTION = "authattempts";

export const authAttemptIndexes: IndexDescription[] = [{ key: { expiresAt: 1 }, expireAfterSeconds: 0 }];
