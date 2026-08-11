import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3 storage for user-uploaded avatars. Enabled when S3_BUCKET +
// S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are all set; otherwise every helper
// no-ops and avatars keep serving from mongo (dev/preview default).
//
// Two endpoints, because the api and the browser may not reach S3 the same way:
// - S3_ENDPOINT: used by the api for PutObject (upload path, boot migration).
// - S3_PUBLIC_ENDPOINT: used to sign the GET URLs the api 302-redirects
//   browsers to — the signed host must be browser-reachable. Defaults to
//   S3_ENDPOINT; in prod both are the public Scaleway gateway, locally both are
//   the MinIO port (see .env.example).
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
let publicClient: S3Client | null = null;
// When set, presigned URLs point at this origin instead of the public endpoint
// — tests serve their mock S3 from it (fetch()-able in-process, so following a
// 302 exercises the full flow). Never set outside tests.
let presignedOriginForTests: string | null = null;

// Exported for tests — spec files can't set env vars before module import
// reliably, so they inject mock clients (or null to reset).
export function setS3ClientsForTests(internal: S3Client | null, pub?: S3Client | null): void {
	client = internal;
	publicClient = pub ?? internal;
	presignedOriginForTests = internal ? "http://s3-mock.local" : null;
}

export function s3Enabled(): boolean {
	// A test-injected client counts as "enabled" even without S3_* env vars.
	if (client && presignedOriginForTests) {
		return true;
	}
	const config = s3Config();
	if (!config) {
		return false;
	}
	client ??= new S3Client(config);
	// The signer must see the public endpoint so the presigned host is one a
	// browser can reach; a separate client only when it differs.
	const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
	publicClient ??=
		publicEndpoint && publicEndpoint !== config.endpoint
			? new S3Client({ ...config, endpoint: publicEndpoint })
			: client;
	return true;
}

function clients(): { internal: S3Client; pub: S3Client } {
	if (!client || !publicClient) {
		throw new Error("S3 accessed while disabled");
	}
	return { internal: client, pub: publicClient };
}

export function avatarS3Key(userId: string, size: string): string {
	return `avatars/${userId}/${size}.webp`;
}

// Test hook: lets spec files serve the mock's "presigned" URLs via plain
// fetch() (the api returns http://s3-mock.local/… redirects when test clients
// are injected). Production code never installs one. Returns the previous
// interceptor so callers can restore it.
type FetchInterceptor = (url: string) => Promise<Response | null>;
const interceptorStore: { current: FetchInterceptor | null } = { current: null };
export function setS3FetchInterceptorForTests(interceptor: FetchInterceptor | null): FetchInterceptor | null {
	const previous = interceptorStore.current;
	interceptorStore.current = interceptor;
	return previous;
}

// Same as fetch(), except S3-mock URLs are served in-process under NODE_ENV=test.
export function s3Fetch(url: string): Promise<Response> {
	const interceptor = interceptorStore.current;
	if (interceptor) {
		return interceptor(url).then((res) => res ?? fetch(url));
	}
	return fetch(url);
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

// Short-lived so a changed avatar stops being served quickly; the ETag stays
// authoritative anyway (browsers revalidate via the api, not S3). Signing is
// local (no network), so failures are a bug — they propagate to the 500 handler.
export async function presignAvatarGet(userId: string, size: string, expiresInSeconds = 3600): Promise<string> {
	const key = avatarS3Key(userId, size);
	if (presignedOriginForTests) {
		return `${presignedOriginForTests}/${process.env.S3_BUCKET ?? "test-bucket"}/${key}?X-Amz-Signature=mock`;
	}
	return getSignedUrl(clients().pub, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
		expiresIn: expiresInSeconds,
	});
}
