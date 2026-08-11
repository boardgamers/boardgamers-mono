// Pure in-memory unit tests — no DB needed, but run via `pnpm test` with the
// rest of the suite (test-hooks boots the API; these tests don't use it).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ipBucketKey, recordAttempt, resetRateLimitCounters } from "./ratelimit.ts";

describe("recordAttempt (in-memory window counter)", () => {
	const limit = { windowMs: 60_000, max: 3 };

	it("allows up to max attempts, then rejects with a retry delay", () => {
		resetRateLimitCounters();
		for (let i = 0; i < limit.max; i++) {
			const result = recordAttempt("test", "key", limit);
			assert.strictEqual(result.allowed, true, `attempt ${i + 1} should be allowed`);
		}
		const rejected = recordAttempt("test", "key", limit);
		assert.strictEqual(rejected.allowed, false);
		assert.ok(rejected.retryAfterSeconds >= 1 && rejected.retryAfterSeconds <= 60);
	});

	it("counts buckets and keys independently", () => {
		resetRateLimitCounters();
		for (let i = 0; i < limit.max; i++) {
			recordAttempt("test", "key", limit);
		}
		assert.strictEqual(recordAttempt("other-bucket", "key", limit).allowed, true);
		assert.strictEqual(recordAttempt("test", "other-key", limit).allowed, true);
	});

	it("resets once the window rolls over", () => {
		resetRateLimitCounters();
		const start = 1_700_000_010_000;
		for (let i = 0; i < limit.max; i++) {
			assert.strictEqual(recordAttempt("test", "key", limit, start).allowed, true);
		}
		assert.strictEqual(recordAttempt("test", "key", limit, start).allowed, false);
		assert.strictEqual(recordAttempt("test", "key", limit, start + limit.windowMs).allowed, true);
	});

	it("sweeps entries from past windows", () => {
		resetRateLimitCounters();
		const start = 1_700_000_010_000;
		recordAttempt("test", "stale", limit, start);
		// A hit one window later triggers the sweep, dropping the stale entry.
		recordAttempt("test", "fresh", limit, start + limit.windowMs + 1);
		// The stale key starts a fresh count even inside neither window boundary.
		assert.strictEqual(recordAttempt("test", "stale", limit, start + limit.windowMs + 2).allowed, true);
	});
});

describe("ipBucketKey", () => {
	it("passes IPv4 through as-is (per /32)", () => {
		assert.strictEqual(ipBucketKey("1.2.3.4"), "1.2.3.4");
		assert.strictEqual(ipBucketKey("203.0.113.99"), "203.0.113.99");
		assert.notStrictEqual(ipBucketKey("1.2.3.4"), ipBucketKey("1.2.3.5"));
	});

	it("unwraps IPv4-mapped IPv6 to the IPv4 address", () => {
		assert.strictEqual(ipBucketKey("::ffff:1.2.3.4"), "1.2.3.4");
		assert.strictEqual(ipBucketKey("::ffff:7f00:1"), "127.0.0.1");
		assert.strictEqual(ipBucketKey("0:0:0:0:0:ffff:0808:0808"), "8.8.8.8");
		// So the same client buckets identically however the socket reports it.
		assert.strictEqual(ipBucketKey("::ffff:127.0.0.1"), ipBucketKey("127.0.0.1"));
	});

	it("masks IPv6 to the /56 network", () => {
		// Same /56, differing only below bit 56 (4th group low byte + beyond) → same bucket.
		const a = ipBucketKey("2001:db8:abcd:1200::1");
		const b = ipBucketKey("2001:db8:abcd:12ff:ffff:ffff:ffff:ffff");
		assert.strictEqual(a, "2001:db8:abcd:1200::/56");
		assert.strictEqual(a, b);
		// The /56 boundary is the low byte of the 4th group: 0x12xx shares, 0x13xx doesn't.
		assert.strictEqual(ipBucketKey("2001:db8:abcd:1299::99"), a);
		assert.notStrictEqual(ipBucketKey("2001:db8:abcd:1300::1"), a);
	});

	it("normalizes compressed and mixed-case IPv6 before masking", () => {
		assert.strictEqual(ipBucketKey("2001:0DB8:ABCD:1200:0000:0000:0000:0001"), "2001:db8:abcd:1200::/56");
		assert.strictEqual(ipBucketKey("2001:db8:abcd:1200::1"), ipBucketKey("2001:db8:abcd:1200:0:0:0:1"));
	});

	it("falls back to the raw string for unparseable input", () => {
		assert.strictEqual(ipBucketKey("not-an-ip"), "not-an-ip");
	});
});
