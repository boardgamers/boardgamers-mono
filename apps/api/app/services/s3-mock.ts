import type { S3Client } from "@aws-sdk/client-s3";
import { setS3FetchInterceptorForTests } from "./s3.ts";

// In-memory fake of the bits of S3 the avatar code uses (PutObject + public
// GETs): spec files inject it via setS3ClientsForTests() and register it as the
// fetch interceptor so following the api's 302 to the mock's public URL
// (http://s3-mock.local/…) exercises the whole redirect flow without network.
export function makeS3Mock() {
	const buckets = new Map<string, Map<string, { body: Buffer; contentType?: string }>>();
	const mock = {
		buckets,
		failing: false,
		// False models the object store being private/unreachable: HEAD probes and
		// GETs 403 (mirrors a private bucket's anonymous response).
		publiclyReadable: true,
		// The host public avatar URLs carry — distinct from any real endpoint so a
		// test can assert the redirect used the *public* endpoint config. The
		// default bucket name mirrors the fallback in putAvatar (no S3_* env in
		// tests).
		endpointHost: "s3-mock.local",
		bucketName: "test-bucket",
		client: {
			send: async (command: { input: { Bucket?: string; Key?: string; Body?: Buffer; ContentType?: string } }) => {
				if (mock.failing) {
					throw new Error("S3 mock failure");
				}
				const { Bucket, Key, Body, ContentType } = command.input;
				let bucket = buckets.get(Bucket!);
				if (!bucket) {
					bucket = new Map();
					buckets.set(Bucket!, bucket);
				}
				bucket.set(Key!, { body: Buffer.from(Body!), contentType: ContentType });
				return {};
			},
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the bits of S3Client the avatar code uses are faked
		} as unknown as S3Client,
		reset() {
			buckets.clear();
			mock.failing = false;
			mock.publiclyReadable = true;
		},
		async handleObjectRequest(url: string, init?: { method?: string }): Promise<Response | null> {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				return null;
			}
			if (parsed.hostname !== "s3-mock.local") {
				return null;
			}
			if (mock.failing) {
				return new Response("S3 mock failure", { status: 500 });
			}
			if (!mock.publiclyReadable) {
				return new Response("AccessDenied", { status: 403 });
			}
			// forcePathStyle URLs: /<bucket>/<key>
			const [bucket, ...keyParts] = parsed.pathname.replace(/^\//, "").split("/");
			const obj = buckets.get(bucket)?.get(keyParts.join("/"));
			if (!obj) {
				return new Response("NoSuchKey", { status: 404 });
			}
			if (init?.method === "HEAD") {
				return new Response(null, { status: 200 });
			}
			return new Response(new Uint8Array(obj.body), {
				status: 200,
				headers: { "Content-Type": obj.contentType ?? "application/octet-stream" },
			});
		},
	};
	return mock;
}

export type S3Mock = ReturnType<typeof makeS3Mock>;

// Registers (userId, size) pairs as "present in S3" so the mock serves bytes
// for their public URL — without an upload having gone through the mock client.
// Used by serving tests, whose fixtures model post-migration state (the api
// only redirects on a GET, it never uploads).
export function seedS3Avatars(mock: S3Mock, avatars: { userId: string; sizes: string[]; body: Buffer }[]) {
	for (const { userId, sizes, body } of avatars) {
		for (const size of sizes) {
			let objects = mock.buckets.get(mock.bucketName);
			if (!objects) {
				objects = new Map();
				mock.buckets.set(mock.bucketName, objects);
			}
			objects.set(`avatars/${userId}/${size}.webp`, { body, contentType: "image/webp" });
		}
	}
}

// Registers the mock as the process-wide S3-URL fetch interceptor (spec files
// run in the same process as the api server, so a global hook is fine) and
// returns a restore function for `after()`.
export function interceptS3Fetches(mock: S3Mock): () => void {
	const previous = setS3FetchInterceptorForTests((url) => mock.handleObjectRequest(url));
	return () => setS3FetchInterceptorForTests(previous);
}
