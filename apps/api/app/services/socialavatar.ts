import assert from "node:assert";
import { safeFetchBuffer } from "./safefetch.ts";

/**
 * Social-provider avatars (Codeberg issue #34): the OAuth handlers capture the
 * profile's avatar URL into account.socialMeta.<provider>.avatarUrl, and
 * POST /api/account/avatar/social copies the image server-side into the regular
 * avatar storage (same resize/S3 pipeline as uploads).
 *
 * That copy is a server-side fetch of a user-influenced URL, so it is locked
 * down hard:
 *  - the URL must be https and its host must match the provider's KNOWN CDN
 *    host list below — checked both at capture time (nothing else is ever
 *    stored) and again at fetch time (defense in depth for stored docs);
 *  - the fetch itself goes through safeFetchBuffer: special-use/loopback IP
 *    blocklist with DNS pinning, no redirects, 10s timeout, hard size cap;
 *  - the response must be 200 with a whitelisted RASTER image content-type (no
 *    SVG — no untrusted XML through librsvg), and sharp re-encodes it — the
 *    original bytes are never stored or served.
 */

export type SocialAvatarProvider = "google" | "facebook" | "discord" | "github" | "huggingface";

// Known avatar CDN locations per provider. Deliberately strict: a miss only means
// the user can't one-click-copy that avatar, while a stray entry widens what the
// api can be told to fetch. `path` (when present) anchors the pathname too — bare
// huggingface.co also serves arbitrary user repo content, so only its known
// avatar path shape (/avatars/…, the default-avatar URLs in the OIDC `picture`
// claim) is allowed.
const AVATAR_SOURCES: Record<SocialAvatarProvider, { host: RegExp; path?: RegExp }[]> = {
	google: [{ host: /^lh\d+\.googleusercontent\.com$/ }],
	// Facebook is being phased out (#99) and its passport profile carries no photo
	// with the default fields — no sources, so nothing is ever captured or fetched.
	facebook: [],
	discord: [{ host: /^cdn\.discordapp\.com$/ }],
	github: [{ host: /^avatars\d*\.githubusercontent\.com$/ }],
	huggingface: [{ host: /^cdn-avatars\.huggingface\.co$/ }, { host: /^huggingface\.co$/, path: /^\/avatars\// }],
};

export const SOCIAL_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const SOCIAL_AVATAR_TIMEOUT_MS = 10_000;

// Raster formats only — deliberately NOT image/*: SVG would route untrusted XML
// through librsvg (extra parser surface in sharp), and provider avatars are
// always raster anyway.
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

/**
 * Validate a provider avatar URL: https only, host on the provider's known CDN
 * list. Returns the normalized URL string, or undefined when it doesn't qualify
 * (never throws — capture is best-effort).
 */
export function validSocialAvatarUrl(provider: SocialAvatarProvider, raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
		return undefined;
	}
	if (!AVATAR_SOURCES[provider].some((s) => s.host.test(url.hostname) && (!s.path || s.path.test(url.pathname)))) {
		return undefined;
	}
	return url.toString();
}

/**
 * Fetch the avatar bytes from an ALREADY-WHITELISTED provider URL. Enforces the
 * transport-level guards (see module doc) and that the response is an image.
 * Throws assert/Error → 400 for anything unexpected.
 */
export async function fetchSocialAvatarBytes(url: string): Promise<Buffer> {
	const response = await safeFetchBuffer(url, {
		timeoutMs: SOCIAL_AVATAR_TIMEOUT_MS,
		maxBodyBytes: SOCIAL_AVATAR_MAX_BYTES,
	});
	assert(response.statusCode === 200, `avatar fetch failed (${response.statusCode})`);
	const contentType = String(response.headers["content-type"] ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	assert(
		ALLOWED_CONTENT_TYPES.has(contentType),
		`avatar fetch returned a non-raster-image content-type (${contentType})`,
	);
	return response.body;
}

export type SocialAvatarFetch = typeof fetchSocialAvatarBytes;

let avatarFetch: SocialAvatarFetch = fetchSocialAvatarBytes;

// Tests swap in a fake so the selection endpoint spec runs without network access.
export function setSocialAvatarFetchForTests(mock: SocialAvatarFetch | null): void {
	avatarFetch = mock ?? fetchSocialAvatarBytes;
}

/**
 * Fetch a provider avatar for copying into our own avatar storage. Re-validates
 * the host whitelist even for stored URLs (defense in depth), then does the
 * guarded fetch.
 */
export async function fetchSocialAvatar(provider: SocialAvatarProvider, rawUrl: string): Promise<Buffer> {
	const url = validSocialAvatarUrl(provider, rawUrl);
	assert(url, `Avatar URL is not on ${provider}'s known CDN`);
	return avatarFetch(url);
}
