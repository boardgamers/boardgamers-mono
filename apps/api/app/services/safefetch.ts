import dns from "node:dns";
import { isIP } from "node:net";
import { Agent, request } from "undici";
import { env } from "../config/index.ts";

/**
 * SSRF-safe HTTP(S) fetch for all server-side calls to user-supplied URLs
 * (CIMD client metadata, per-user notification webhooks — #85/#33).
 *
 * Protections:
 *  - The hostname is resolved and every address checked against the
 *    special-use/loopback blocklist (`isSpecialUseIP`); the loopback exception
 *    applies only outside production (dev/tests on loopback).
 *  - DNS-rebinding TOCTOU: the connection is pinned to the ALREADY-VALIDATED
 *    addresses via an undici Agent whose connect.lookup replays them, so the
 *    socket can only ever connect to an IP that passed the check.
 *  - https only (loopback http allowed only outside production), no redirects
 *    (undici.request does not follow them), 10s timeout, capped response body.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

const IPV4_SPECIAL_USE: [number, number][] = [
	[0x00000000, 0x000000ff], // 0.0.0.0/8 "this network"
	[0x0a000000, 0x0affffff], // 10.0.0.0/8 private
	[0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
	[0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
	[0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
	[0xac100000, 0xac1fffff], // 172.16.0.0/12 private
	[0xc0000000, 0xc00000ff], // 192.0.0.0/24 protocol assignments
	[0xc0000200, 0xc00002ff], // 192.0.2.0/24 documentation (TEST-NET-1)
	[0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
	[0xc6336400, 0xc63364ff], // 192.88.99.0/24 deprecated 6to4 relay
	[0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private
	[0xcb007100, 0xcb0071ff], // 203.0.113.0/24 documentation (TEST-NET-3)
	[0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
	[0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved + broadcast
];

function ipv4ToLong(ip: string): number {
	return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function ip6Bytes(ip: string): Buffer {
	// Minimal IPv6 parser: expand the single "::" run of zeroes, split hextets,
	// support an embedded IPv4 tail (::ffff:1.2.3.4). Throws on invalid input.
	const doubleColon = ip.indexOf("::");
	if (doubleColon !== ip.lastIndexOf("::")) {
		throw new Error("invalid ipv6");
	}
	const toHextets = (parts: string[]): number[] => {
		const out: number[] = [];
		for (const part of parts) {
			if (!part) {
				continue;
			}
			if (part.includes(".")) {
				if (isIP(part) !== 4) {
					throw new Error("invalid ipv6");
				}
				const v4 = ipv4ToLong(part);
				out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
			} else {
				if (!/^[0-9a-f]{1,4}$/.test(part)) {
					throw new Error("invalid ipv6");
				}
				out.push(parseInt(part, 16));
			}
		}
		return out;
	};
	let hextets: number[];
	if (doubleColon === -1) {
		hextets = toHextets(ip.split(":"));
	} else {
		const head = toHextets(ip.slice(0, doubleColon).split(":"));
		const tail = toHextets(ip.slice(doubleColon + 2).split(":"));
		if (head.length + tail.length >= 8) {
			throw new Error("invalid ipv6");
		}
		hextets = [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
	}
	if (hextets.length !== 8) {
		throw new Error("invalid ipv6");
	}
	const bytes = Buffer.alloc(16);
	hextets.forEach((h, i) => bytes.writeUInt16BE(h, i * 2));
	return bytes;
}

/**
 * Special-use IPv6 prefixes (RFC6890): ::/128, ::1/128, ::ffff:0:0/96 (mapped,
 * delegated to the IPv4 table), 64:ff9b::/96, 100::/64, 2001::/23 (teredo etc. —
 * this is a blocklist, so over-blocking the assignable exceptions inside it is
 * the safe direction), 2001:db8::/32 documentation, 2002::/16 6to4, fc00::/7
 * unique local, fe80::/10 link-local, ff00::/8 multicast.
 */
function isSpecialUseIPv6(ip: string): boolean {
	let b: Buffer;
	try {
		b = ip6Bytes(ip);
	} catch {
		return true; // unparseable → not safe
	}
	if (b.subarray(0, 15).every((v) => v === 0) && b[15] <= 1) {
		return true; // ::/128, ::1/128
	}
	if (b.subarray(0, 10).every((v) => v === 0) && b[10] === 0xff && b[11] === 0xff) {
		return isSpecialUseIPv4([...b.subarray(12)].join(".")); // IPv4-mapped
	}
	const first = b.readUInt16BE(0);
	if (first === 0x64 && b.readUInt16BE(2) === 0xff9b) {
		return true; // 64:ff9b::/96 translation
	}
	if (first === 0x0100) {
		return true; // 100::/64 discard-only
	}
	if (first === 0x2001 && b[2] >> 1 === 0) {
		return true; // 2001:00::/23 (teredo & friends)
	}
	if (first === 0x2001 && b[2] === 0x0d && b[3] === 0xb8) {
		return true; // 2001:db8::/32 documentation
	}
	if (first === 0x2002) {
		return true; // 2002::/16 6to4
	}
	if ((b[0] & 0xfe) === 0xfc) {
		return true; // fc00::/7 unique local
	}
	if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) {
		return true; // fe80::/10 link-local
	}
	if (b[0] === 0xff) {
		return true; // ff00::/8 multicast
	}
	return false;
}

function isSpecialUseIPv4(ip: string): boolean {
	const long = ipv4ToLong(ip);
	return IPV4_SPECIAL_USE.some(([start, end]) => long >= start && long <= end);
}

export function isSpecialUseIP(ip: string): boolean {
	const family = isIP(ip);
	if (family === 4) {
		return isSpecialUseIPv4(ip);
	}
	if (family === 6) {
		return isSpecialUseIPv6(ip.toLowerCase());
	}
	return true;
}

export function isIPV4OrV6Loopback(ip: string): boolean {
	if (isIP(ip) === 4) {
		return ip.startsWith("127.");
	}
	return ip === "::1" || ip === "0:0:0:0:0:0:0:1";
}

export function isLoopbackHostname(hostname: string): boolean {
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return true;
	}
	return isSpecialUseIP(hostname) && isIPV4OrV6Loopback(hostname);
}

/**
 * Resolve a hostname and return its addresses after the special-use check.
 * The loopback exception only applies to dev/test deployments where the AS
 * itself runs on loopback. In production any special-use target is refused.
 */
export async function resolveAllowedAddresses(hostname: string): Promise<string[]> {
	let addresses: string[];
	if (isIP(hostname) !== 0) {
		addresses = [hostname];
	} else {
		const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
		addresses = results.map((r) => r.address);
	}
	if (addresses.length === 0) {
		throw new Error(`could not resolve ${hostname}`);
	}
	const blocked = env.isProduction ? isSpecialUseIP : (ip: string) => isSpecialUseIP(ip) && !isIPV4OrV6Loopback(ip);
	for (const address of addresses) {
		if (blocked(address)) {
			throw new Error(`${hostname} resolves to a special-use IP address`);
		}
	}
	return addresses;
}

/**
 * DNS pinning against DNS-rebinding TOCTOU. Validating a hostname via dns.lookup
 * and then letting the HTTP client re-resolve it independently is a well-known
 * bypass: an attacker-controlled DNS server hands a public IP to the validation
 * lookup and 127.0.0.1/internal to the fetch's re-resolution. To close it, the
 * request runs through an undici Agent whose connect.lookup replays the
 * ALREADY-VALIDATED addresses (node lookup signature, all-mode array), so the
 * socket can only ever connect to an IP that passed the special-use check. TLS
 * SNI / cert verification and the HTTP Host header still use the real hostname.
 *
 * (We use undici.request + a custom Agent rather than global fetch: the standalone
 * undici v8 Agent's dispatcher protocol is incompatible with Node's built-in
 * fetch, which then throws "invalid onRequestStart method".)
 */
export function pinnedLookup(addresses: string[]) {
	return (
		_hostname: string,
		options: { all?: boolean },
		callback: (err: null, addresses: { address: string; family: 4 | 6 }[]) => void,
	) => {
		callback(
			null,
			addresses.map((address) => ({ address, family: isIP(address) === 6 ? (6 as const) : (4 as const) })),
		);
	};
}

/** https only; the loopback http exception is allowed only outside production. */
export function assertSafeUrlScheme(url: URL, what = "URL"): void {
	if (
		url.protocol !== "https:" &&
		!(!env.isProduction && url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new Error(`${what} must use the https scheme`);
	}
}

export interface SafeFetchOptions {
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	maxBodyBytes?: number;
}

export interface SafeFetchResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/**
 * SSRF-safe request to a user-supplied URL: validates the scheme, resolves and
 * blocklists special-use addresses, pins the connection to them, never follows
 * redirects, and reads at most `maxBodyBytes` of the response body. Throws on
 * any failure; the response status is NOT checked (callers decide what 4xx/5xx
 * mean for them).
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
	const parsed = new URL(url);
	assertSafeUrlScheme(parsed);
	const addresses = await resolveAllowedAddresses(parsed.hostname);

	const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await request(url, {
			method: options.method ?? "GET",
			headers: options.headers,
			body: options.body,
			dispatcher,
			signal: controller.signal,
		});

		const chunks: Uint8Array[] = [];
		let total = 0;
		for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
			total += chunk.length;
			if (total > maxBodyBytes) {
				throw new Error("response body too large");
			}
			chunks.push(chunk);
		}

		return {
			statusCode: response.statusCode,
			headers: response.headers,
			body: Buffer.concat(chunks).toString("utf-8"),
		};
	} finally {
		clearTimeout(timer);
		await dispatcher.close().catch(() => {});
	}
}
