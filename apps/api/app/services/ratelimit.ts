// Per-IP fixed-window attempt counter, in memory. Prod runs the api as a PM2
// cluster (2 workers), so the configured limit is per-process — the effective
// cap is limit × workers. Accepted for this first pass (#195): the goal is to
// make bulk email enumeration impractical, not to meter exactly, and it avoids
// a mongo write on every login attempt.
//
// The window is "fixed" in the strict sense: bucketed by floor(now/windowMs).

type WindowCounter = { count: number; windowStart: number };

const counters = new Map<string, WindowCounter>();
let lastSweep = Date.now();

// Periodic cleanup: without it the map grows by one entry per IP per window,
// forever. Entries from past windows can never be hit again.
function sweep(now: number, windowMs: number) {
	if (now - lastSweep < windowMs) {
		return;
	}
	lastSweep = now;
	const currentWindow = now - (now % windowMs);
	for (const [key, counter] of counters) {
		if (counter.windowStart < currentWindow) {
			counters.delete(key);
		}
	}
}

/**
 * Count one attempt for `key` in the current window and report whether it's
 * within `limit.max`. The window resets by wall-clock alignment: the first hit
 * after `windowStart + windowMs` starts a fresh count.
 */
export function recordAttempt(
	bucket: string,
	key: string,
	limit: { windowMs: number; max: number },
	now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
	sweep(now, limit.windowMs);

	const windowStart = now - (now % limit.windowMs);
	const id = `${bucket}:${key}`;
	let counter = counters.get(id);
	if (!counter || counter.windowStart < windowStart) {
		counter = { count: 0, windowStart };
		counters.set(id, counter);
	}
	counter.count += 1;

	const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + limit.windowMs - now) / 1000));
	return { allowed: counter.count <= limit.max, retryAfterSeconds };
}

// --- IP bucketing -----------------------------------------------------------

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function isIpv4(ip: string): boolean {
	if (!IPV4_RE.test(ip)) {
		return false;
	}
	return ip.split(".").every((part) => Number(part) <= 255);
}

function parseIpv6Half(half: string): number[] {
	return half === "" ? [] : half.split(":").map((g) => parseInt(g, 16));
}

function expandIpv6(ip: string): string[] | null {
	if (ip.includes(".")) {
		// IPv4 tail (e.g. ::ffff:1.2.3.4): hex groups + 32 bits of dotted decimal.
		const lastColon = ip.lastIndexOf(":");
		const v4 = ip.slice(lastColon + 1);
		if (!isIpv4(v4)) {
			return null;
		}
		const v4Parts = v4.split(".").map(Number);
		const hi = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
		const lo = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
		ip = `${ip.slice(0, lastColon)}:${hi}:${lo}`;
	}

	const doubleColon = ip.split("::");
	if (doubleColon.length > 2) {
		return null;
	}
	const head = parseIpv6Half(doubleColon[0]);
	const tail = doubleColon.length === 2 ? parseIpv6Half(doubleColon[1]) : [];
	const groups =
		doubleColon.length === 2 ? [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail] : head;
	if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
		return null;
	}
	return groups.map((g) => g.toString(16));
}

/**
 * Rate-limit bucket key for a client IP: IPv6 is masked to its /56 network —
 * a v6 user typically controls a whole /56 or /64 and could otherwise rotate
 * addresses within it to evade the limit. IPv4 (including v4-mapped v6, e.g.
 * `::ffff:1.2.3.4`) buckets by the full address.
 */
export function ipBucketKey(ip: string): string {
	if (isIpv4(ip)) {
		return ip;
	}
	const groups = expandIpv6(ip.toLowerCase());
	if (!groups) {
		// Unparseable (shouldn't happen with a real socket/proxy address) — bucket
		// by the raw string rather than dropping the limit.
		return ip;
	}
	if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
		return groups
			.slice(6)
			.map((g) => parseInt(g, 16))
			.flatMap((v) => [v >> 8, v & 0xff])
			.join(".");
	}
	// /56: keep the first 56 bits (3.5 groups), zero the rest.
	return `${groups[0]}:${groups[1]}:${groups[2]}:${(parseInt(groups[3], 16) & 0xff00).toString(16)}::/56`;
}

/** Test hook: wipe every counter (specs also use unique IPs per test). */
export function resetRateLimitCounters(): void {
	counters.clear();
	lastSweep = Date.now();
}
