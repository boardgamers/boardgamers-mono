import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

// S3 storage for user-uploaded avatars. Enabled when S3_BUCKET +
// S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are all set; otherwise every helper
// no-ops and avatars keep serving from mongo (dev default).
//
// Avatars are PUBLIC objects (anyone can view any user's avatar): the bucket is
// public-read at the operator level (#218), so serving redirects to the plain
// object URL — no presigning, no per-object ACL. The public base is derived
// from S3_PUBLIC_ENDPOINT + S3_BUCKET (default: S3_ENDPOINT); it must be
// browser-reachable. Envs with the base URL but no creds (PR previews: no S3
// secrets) still 302 to the public gateway — anonymous GET works.
//
// If the bucket is NOT publicly readable yet (operator step pending), a
// HEAD-probe (see isAvatarPubliclyReachable) fails and the api keeps serving
// from mongo — avatar serving never depends on the bucket being public.
//
// - S3_ENDPOINT: used by the api for PutObject (upload path, boot migration).
// - S3_PUBLIC_ENDPOINT: the public base the api 302-redirects browsers to.
//   Defaults to S3_ENDPOINT; in prod both are the public Scaleway gateway,
//   locally both are the MinIO port (see .env.example).
function s3Config(): S3ClientConfig | null {
	const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
	if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
		return null;
	}
	return {
		region: process.env.S3_REGION || "fr-par",
		endpoint: process.env.S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
		// Scaleway (and most S3-compatible stores) want path-style URLs.
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
	};
}

let client: S3Client | null = null;
// When set, avatar URLs point at this origin instead of the public endpoint —
// tests serve their mock S3 from it (fetch()-able in-process, so following a
// 302 exercises the full flow). Never set outside tests.
let publicOriginForTests: string | null = null;

// Exported for tests — spec files can't set env vars before module import
// reliably, so they inject a mock client (or null to reset).
export function setS3ClientsForTests(internal: S3Client | null): void {
	client = internal;
	publicOriginForTests = internal ? "http://s3-mock.local" : null;
}

export function s3Enabled(): boolean {
	// A test-injected client counts as "enabled" even without S3_* env vars.
	if (client && publicOriginForTests) {
		return true;
	}
	const config = s3Config();
	if (!config) {
		return false;
	}
	client ??= new S3Client(config);
	return true;
}

function clients(): { internal: S3Client } {
	if (!client) {
		throw new Error("S3 accessed while disabled");
	}
	return { internal: client };
}

export function avatarS3Key(userId: string, size: string): string {
	return `avatars/${userId}/${size}.webp`;
}

// Test hook: lets spec files serve the mock's public object URLs via plain
// fetch() (the api returns http://s3-mock.local/… redirects when test clients
// are injected). Production code never installs one. Returns the previous
// interceptor so callers can restore it.
type FetchInterceptor = (url: string, init?: { method?: string }) => Promise<Response | null>;
const interceptorStore: { current: FetchInterceptor | null } = { current: null };
export function setS3FetchInterceptorForTests(interceptor: FetchInterceptor | null): FetchInterceptor | null {
	const previous = interceptorStore.current;
	interceptorStore.current = interceptor;
	return previous;
}

// Same as fetch(), except S3-mock URLs are served in-process under NODE_ENV=test.
export function s3Fetch(url: string, init?: { method?: string }): Promise<Response> {
	const interceptor = interceptorStore.current;
	if (interceptor) {
		return interceptor(url, init).then((res) => res ?? fetch(url, init));
	}
	return fetch(url, init);
}

// Failure mode: throws or returns false — never breaks the caller. The mongo
// dual-write stays the fallback and the doc just keeps s3 unset (the boot
// migration picks it up later).
export async function putAvatar(userId: string, size: string, webp: Buffer): Promise<boolean> {
	const input = {
		// "test-bucket" fallback: with injected test clients there are no S3_* env
		// vars; prod/dev always has S3_BUCKET set when s3Enabled() is true.
		Bucket: process.env.S3_BUCKET ?? "test-bucket",
		Key: avatarS3Key(userId, size),
		Body: webp,
		ContentType: "image/webp",
	};
	try {
		await clients().internal.send(new PutObjectCommand(input), { abortSignal: AbortSignal.timeout(10_000) });
		return true;
	} catch (err) {
		console.warn(`avatar S3 write failed (${userId} ${size}):`, err instanceof Error ? err.message : err);
		return false;
	}
}

// The plain (unsigned) URL for an avatar object, or null when the env has no
// public S3 base URL at all (fully S3-less env → the caller serves from mongo
// or falls back to a generated avatar). Avatars are public-read, so no signing
// — which also makes the URL cacheable and usable by creds-less previews.
export function publicAvatarUrl(userId: string, size: string): string | null {
	if (publicOriginForTests) {
		return `${publicOriginForTests}/${process.env.S3_BUCKET ?? "test-bucket"}/${avatarS3Key(userId, size)}`;
	}
	if (!process.env.S3_BUCKET) {
		return null;
	}
	const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || "https://s3.fr-par.scw.cloud";
	// forcePathStyle: <endpoint>/<bucket>/<key>
	return `${publicEndpoint.replace(/\/+$/, "")}/${process.env.S3_BUCKET}/${avatarS3Key(userId, size)}`;
}

// -- Public-reachability probe ------------------------------------------------
// The api 302s to the public URL only once an anonymous HEAD on the object
// confirms the bucket serves it publicly (#218); until then it serves the mongo
// blob. The verdict is cached in-process: negatives briefly (the operator may
// flip the policy at any moment), positives ~forever (a public bucket stays
// public; a blip just re-probes on a later request). Bounded by the number of
// avatar keys requested, × the short negative TTL — never a traffic multiplier
// worth worrying about next to a mongo blob read.
const publicProbeCache = new Map<string, Promise<boolean>>();
const PROBE_NEGATIVE_TTL_MS = 30_000;
const PROBE_POSITIVE_TTL_MS = 3600_000;

export function isAvatarPubliclyReachable(userId: string, size: string): Promise<boolean> {
	const url = publicAvatarUrl(userId, size);
	if (!url) {
		return Promise.resolve(false);
	}
	const cached = publicProbeCache.get(url);
	if (cached) {
		return cached;
	}
	const probe = s3Fetch(url, { method: "HEAD" })
		.then((res) => res.ok)
		.catch(() => false)
		.then((ok) => {
			setTimeout(
				() => {
					if (publicProbeCache.get(url) === probe) {
						publicProbeCache.delete(url);
					}
				},
				ok ? PROBE_POSITIVE_TTL_MS : PROBE_NEGATIVE_TTL_MS,
			).unref();
			return ok;
		});
	publicProbeCache.set(url, probe);
	return probe;
}

// Exported for tests.
export function clearAvatarPublicProbeCache(): void {
	publicProbeCache.clear();
}
