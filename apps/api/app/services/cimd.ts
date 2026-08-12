import NodeCache from "node-cache";
import { z } from "zod";
import { env } from "../config/index.ts";
import {
	assertSafeUrlScheme,
	isLoopbackHostname,
	isSpecialUseIP,
	pinnedLookup,
	resolveAllowedAddresses,
	safeFetch,
} from "./safefetch.ts";

// Re-exported: consumers (incl. specs) imported the SSRF helpers from here
// before they moved to safefetch.ts.
export { isSpecialUseIP, pinnedLookup, resolveAllowedAddresses };

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
	assertSafeUrlScheme(url, "client_id");
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

const redirectUriRule = z.string().refine(isValidRedirectUri, "redirect_uris entries must be https URLs");

/**
 * N5: https-only for URLs that a consent UI may later render or the AS may fetch
 * (§8.8/§9.2). z.url() accepts javascript:/data:, which would be stored-XSS or
 * cross-domain tracking if logo_uri & co. were ever rendered — pin the scheme now.
 */
const httpsUrlRule = z.url().refine((u) => new URL(u).protocol === "https:", "must be an https URL");

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
		logo_uri: httpsUrlRule.optional(),
		client_uri: httpsUrlRule.optional(),
		policy_uri: httpsUrlRule.optional(),
		tos_uri: httpsUrlRule.optional(),
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

	// §5: redirects MUST NOT be followed (a redirect would smuggle metadata from
	// a different origin than the validated client_id); safeFetch doesn't.
	// §8.7: read at most ~5 kB — enforced on the advertised length AND the
	// streamed body (a missing/lying content-length must not bypass the cap).
	const response = await safeFetch(clientId, {
		method: "GET",
		headers: { Accept: "application/json" },
		maxBodyBytes: MAX_METADATA_BYTES,
	});

	if (response.statusCode !== 200) {
		throw new Error(`client metadata fetch returned ${response.statusCode}`);
	}

	const contentLengthHeader = response.headers["content-length"];
	const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader);
	if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) {
		throw new Error("client metadata document too large");
	}

	let raw: unknown;
	try {
		raw = JSON.parse(response.body);
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
