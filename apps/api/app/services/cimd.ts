import dns from "node:dns";
import { isIP } from "node:net";
import NodeCache from "node-cache";
import { z } from "zod";
import { env } from "../config/index.ts";

/**
 * Client ID Metadata Documents (CIMD), provider side (issue #76): a CIMD client
 * identifies itself by an https URL as `client_id`; this module fetches and
 * validates that document.
 *
 * @see https://drafts.oauth.net/draft-ietf-oauth-client-id-metadata-document/draft-ietf-oauth-client-id-metadata-document.html
 *
 * Current-draft requirements implemented here:
 *  - §3 Client Identifier URL: https only, must have a path, no userinfo, no
 *    fragment, no single/double-dot path segments; exact string comparison.
 *  - §4.1 no shared-secret credentials: token_endpoint_auth_method must be
 *    "none"; client_secret* properties are forbidden (PKCE S256 is the substitute).
 *  - §4.2 redirect_uris: exact string match against the fetched document.
 *  - §5: the document must be served with a 200; redirects are NOT followed.
 *  - §8.6 SSRF: refuse URLs resolving to special-use/loopback IPs. The loopback
 *    exception is allowed only outside production (dev/tests on loopback).
 *  - §8.7: read at most ~5 kB of metadata (enforced on content-length AND the
 *    streamed body).
 */

const MAX_METADATA_BYTES = 5 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

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

async function assertFetchableHost(hostname: string): Promise<void> {
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
	// §8.6: the loopback exception only applies to dev/test deployments where the
	// AS itself runs on loopback. In production any special-use target is refused.
	const blocked = env.isProduction ? isSpecialUseIP : (ip: string) => isSpecialUseIP(ip) && !isIPV4OrV6Loopback(ip);
	for (const address of addresses) {
		if (blocked(address)) {
			throw new Error(`${hostname} resolves to a special-use IP address`);
		}
	}
}

function isIPV4OrV6Loopback(ip: string): boolean {
	if (isIP(ip) === 4) {
		return ip.startsWith("127.");
	}
	return ip === "::1" || ip === "0:0:0:0:0:0:0:1";
}

/** §3: validate a Client Identifier URL. Returns the canonical exact string. */
export function validateClientIdUrl(clientId: string): URL {
	let url: URL;
	try {
		url = new URL(clientId);
	} catch {
		throw new Error("client_id is not a valid URL");
	}
	// §8.6 loopback exception, mirrored for the scheme: outside production (dev /
	// tests on loopback) an http:// loopback client_id is allowed; production is
	// strictly https.
	if (
		url.protocol !== "https:" &&
		!(!env.isProduction && url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new Error("client_id must use the https scheme");
	}
	if (url.username || url.password) {
		throw new Error("client_id must not contain a userinfo component");
	}
	if (url.hash) {
		throw new Error("client_id must not contain a fragment");
	}
	// URL parsing strips a bare empty path to "/", so "/" means "no real path"
	// (§3: MUST contain a path; "https://example.com/" is NOT RECOMMENDED → reject).
	if (url.pathname === "/") {
		throw new Error("client_id must contain a path component");
	}
	if (url.pathname.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new Error("client_id must not contain dot path segments");
	}
	return url;
}

/** CIMD redirect_uris entries: https only (loopback http accepted outside prod, RFC8252 §7.3). */
function isValidRedirectUri(uri: string): boolean {
	try {
		const parsed = new URL(uri);
		if (parsed.protocol === "https:") {
			return true;
		}
		return !env.isProduction && parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
	} catch {
		return false;
	}
}

function isLoopbackHostname(hostname: string): boolean {
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return true;
	}
	return isSpecialUseIP(hostname) && isIPV4OrV6Loopback(hostname);
}

const redirectUriRule = z.string().refine(isValidRedirectUri, "redirect_uris entries must be https URLs");

const cimdDocumentSchema = z
	.object({
		client_id: z.string(),
		client_name: z.string().min(1),
		redirect_uris: z.array(redirectUriRule).min(1),
		// §4.1: no shared secret can be established from a metadata document, so a
		// CIMD client is a public client — "none" only. Anything secret-based
		// (client_secret_post/basic/jwt, …) is rejected, as is declaring a
		// client_secret property at all.
		token_endpoint_auth_method: z.literal("none"),
		grant_types: z.array(z.string()).optional(),
		response_types: z.array(z.string()).optional(),
		scope: z.string().optional(),
		logo_uri: z.url().optional(),
		client_uri: z.url().optional(),
		policy_uri: z.url().optional(),
		tos_uri: z.url().optional(),
	})
	.strict();

export type CimdDocument = z.infer<typeof cimdDocumentSchema>;

/**
 * Fetch and validate the Client ID Metadata Document at `clientId`.
 * Throws with a descriptive message on any failure (callers turn that into an
 * OAuth `invalid_client`/400).
 */
export async function fetchClientMetadata(clientId: string): Promise<CimdDocument> {
	validateClientIdUrl(clientId);
	const { hostname } = new URL(clientId);
	await assertFetchableHost(hostname);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	let response: Response;
	try {
		// §5: redirects MUST NOT be followed (a redirect would smuggle metadata from
		// a different origin than the validated client_id).
		response = await fetch(clientId, {
			headers: { Accept: "application/json" },
			redirect: "manual",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}

	if (response.status !== 200) {
		throw new Error(`client metadata fetch returned ${response.status}`);
	}

	// §8.7: read at most ~5 kB — enforce on the advertised length AND the stream
	// (a missing/lying content-length must not bypass the cap).
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) {
		throw new Error("client metadata document too large");
	}
	if (!response.body) {
		throw new Error("client metadata response has no body");
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for await (const chunk of response.body) {
			total += (chunk as Uint8Array).length;
			if (total > MAX_METADATA_BYTES) {
				throw new Error("client metadata document too large");
			}
			chunks.push(chunk as Uint8Array);
		}
	} finally {
		await response.body.cancel().catch(() => {});
	}

	let raw: unknown;
	try {
		raw = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	} catch {
		throw new Error("client metadata document is not valid JSON");
	}
	const parsed = cimdDocumentSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`invalid client metadata document: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
	}
	// §4: the document's client_id must match the URL it was fetched from (exact
	// string comparison — no normalization of default ports or case).
	if (parsed.data.client_id !== clientId) {
		throw new Error("client metadata client_id does not match the requested client_id");
	}
	return parsed.data;
}

/** §4.2: exact string match — no prefix/suffix/wildcard matching. */
export function isRegisteredRedirectUri(metadata: CimdDocument, redirectUri: string): boolean {
	return metadata.redirect_uris.includes(redirectUri);
}

/**
 * Short cache for validated documents (§5.2). Successful fetches only — errors
 * and malformed documents are never cached (§5.2 MUST NOT). 5 min keeps a client
 * that edits its metadata between authorize and token redeemable, without
 * re-fetching (and re-validating SSRF-wise) on every request.
 */
const metadataCache = new NodeCache({ stdTTL: 300, useClones: false });

export async function getClientMetadata(clientId: string): Promise<CimdDocument> {
	const cached = metadataCache.get<CimdDocument>(clientId);
	if (cached) {
		return cached;
	}
	const metadata = await fetchClientMetadata(clientId);
	metadataCache.set(clientId, metadata);
	return metadata;
}
