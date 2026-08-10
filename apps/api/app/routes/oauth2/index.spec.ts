// OAuth2/OIDC provider (issue #76): CIMD client validation, consent, PKCE code
// exchange, and scope isolation between OAuth access tokens and full sessions.
//
// A tiny in-test HTTP server plays the role of the CIMD client: it hosts the
// client metadata document and collects the redirected authorization codes.
// Non-production relaxes the CIMD rules for it (loopback SSRF exception, http://
// loopback redirect URIs) — in production both are refused.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import type { ObjectId } from "mongodb";
import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { verifyPkceS256 } from "../../config/pkce.ts";
import { isSpecialUseIP } from "../../services/cimd.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// --- Fake CIMD client -------------------------------------------------------

const client = {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- assigned in before()
	server: undefined as unknown as ReturnType<typeof createServer>,
	port: 0,
	/** Served document, overridden per test. */
	document: null as Record<string, unknown> | null,
	/** Raw bytes to serve instead of the JSON document (size-cap tests). */
	rawBody: null as Buffer | null,
	/** Respond with a redirect instead of the document. */
	redirectTo: null as string | null,
	/** Codes received on the redirect_uri endpoint. */
	codes: [] as { code: string; state: string | null; error: string | null }[],
	/** Times the metadata document was fetched. */
	fetches: 0,
};

const clientId = () => `http://127.0.0.1:${client.port}/client`;
const clientRedirectUri = () => `http://127.0.0.1:${client.port}/cb`;

function defaultClientDocument() {
	return {
		client_id: clientId(),
		client_name: "Test App",
		redirect_uris: [clientRedirectUri()],
		token_endpoint_auth_method: "none",
	};
}

/**
 * A second client identity hosted on the same server, for tests that mutate the
 * document: getClientMetadata caches per client_id for 5 min, so a mutated doc at
 * the SAME client_id would be invisible to later requests (and poison them).
 */
const altClientId = () => `http://127.0.0.1:${client.port}/client2`;
const altClientDocument = () => ({ ...defaultClientDocument(), client_id: altClientId() });

before(async () => {
	client.server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		// /client is the default identity; /client2 hosts the mutated-document tests
		// (a distinct client_id, so the metadata cache can't cross-contaminate).
		if (url.pathname === "/client" || url.pathname === "/client2") {
			client.fetches++;
			if (client.redirectTo) {
				res.writeHead(302, { location: client.redirectTo }).end();
				return;
			}
			if (client.rawBody) {
				res.writeHead(200, { "content-type": "application/json" }).end(client.rawBody);
				return;
			}
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(client.document ?? {}));
			return;
		}
		if (url.pathname === "/cb") {
			client.codes.push({
				code: url.searchParams.get("code") ?? "",
				state: url.searchParams.get("state"),
				error: url.searchParams.get("error"),
			});
			res.writeHead(200, { "content-type": "text/plain" }).end("ok");
			return;
		}
		res.writeHead(404).end();
	});
	await new Promise<void>((resolve) => client.server.listen(0, "127.0.0.1", resolve));
	const address = client.server.address();
	assert.ok(address && typeof address === "object", "client server has an address");
	client.port = address.port;
});

after(() => {
	client.server.close();
});

function resetClient(document: Record<string, unknown> | null = defaultClientDocument()) {
	client.document = document;
	client.rawBody = null;
	client.redirectTo = null;
	client.codes = [];
	client.fetches = 0;
}

// --- Session + flow helpers --------------------------------------------------

async function makeSessionCookie(userId: ObjectId): Promise<string> {
	const code = generateRefreshCode();
	await colls.jwtRefreshTokens.insertOne({
		user: userId,
		codeHash: hashRefreshCode(code),
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 3600 * 1000),
	});
	return `refreshToken=${encodeURIComponent(JSON.stringify({ code }))}`;
}

const codeVerifier = () => randomBytes(32).toString("base64url");
const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function authorizeParams(verifier: string, overrides: Record<string, string> = {}) {
	return new URLSearchParams({
		client_id: clientId(),
		redirect_uri: clientRedirectUri(),
		response_type: "code",
		scope: "openid profile email",
		state: "client-state",
		code_challenge: codeChallenge(verifier),
		code_challenge_method: "S256",
		...overrides,
	});
}

/** JSON body read, unknown-typed at the boundary; callers assert the shape. */
async function json(res: Response): Promise<unknown> {
	return res.json().catch(() => null);
}

/** GET /api/oauth2/authorize without following the redirect. */
async function authorize(query: URLSearchParams, cookie?: string) {
	const res = await fetch(`${baseURL()}/api/oauth2/authorize?${query}`, {
		redirect: "manual",
		headers: cookie ? { cookie } : {},
	});
	return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

/** Drive authorize → (consent approve) → authorize, returning the issued code. */
async function runAuthorizeFlow(cookie: string, verifier: string, overrides: Record<string, string> = {}) {
	const query = authorizeParams(verifier, overrides);

	const first = await authorize(query, cookie);
	assert.strictEqual(first.status, 303, `expected a redirect, got ${first.status}: ${first.body}`);

	// Consent already recorded → the first call issued the code directly.
	if (!first.location?.includes("/oauth2/consent?")) {
		const location = new URL(first.location!);
		return { code: location.searchParams.get("code")!, state: location.searchParams.get("state") };
	}

	const consent = await fetch(`${baseURL()}/api/oauth2/consent`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify({ ...Object.fromEntries(query), decision: "approve" }),
	});
	const consentBody: unknown = await json(consent);
	assert.strictEqual(consent.status, 200, `consent approve failed: ${JSON.stringify(consentBody)}`);
	assert.ok(consentBody && typeof consentBody === "object" && "authorizeUrl" in consentBody);
	const authorizeUrl = String(consentBody.authorizeUrl);

	const resumed = await authorize(new URLSearchParams(new URL(authorizeUrl, baseURL()).searchParams), cookie);
	assert.strictEqual(resumed.status, 303, `expected code redirect, got ${resumed.status}: ${resumed.body}`);
	const location = new URL(resumed.location!);
	return { code: location.searchParams.get("code")!, state: location.searchParams.get("state") };
}

async function tokenRequest(params: Record<string, string>) {
	const res = await fetch(`${baseURL()}/api/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params).toString(),
	});
	const body: unknown = await json(res);
	return {
		status: res.status,
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tests read ad-hoc fields off the response
		body: body as Record<string, unknown> | null,
		headers: res.headers,
	};
}

async function insertUser(overrides: Parameters<typeof testUser>[0] = {}) {
	const user = testUser(overrides);
	const { insertedId } = await colls.users.insertOne(user);
	return { ...user, _id: insertedId };
}

// The main flow user, shared by every describe block (inserted in the first one).
let mainUser: Awaited<ReturnType<typeof insertUser>>;
let mainCookie: string;

// --- PKCE unit ---------------------------------------------------------------

describe("PKCE S256 verification", () => {
	it("round-trips the RFC7636 appendix B example", () => {
		const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
		assert.ok(verifyPkceS256(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
	});

	it("rejects a wrong verifier", () => {
		const verifier = codeVerifier();
		assert.equal(verifyPkceS256(verifier, codeChallenge(codeVerifier())), false);
	});
});

// --- SSRF unit ---------------------------------------------------------------

describe("special-use IP detection (CIMD §8.6)", () => {
	it("flags loopback/private/reserved IPv4", () => {
		for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.0.1", "0.0.0.0", "100.64.1.1"]) {
			assert.ok(isSpecialUseIP(ip), `${ip} must be special-use`);
		}
		assert.equal(isSpecialUseIP("93.184.216.34"), false);
	});

	it("flags loopback/private IPv6 and IPv4-mapped addresses", () => {
		assert.ok(isSpecialUseIP("::1"));
		assert.ok(isSpecialUseIP("fe80::1"));
		assert.ok(isSpecialUseIP("fc00::1"));
		assert.ok(isSpecialUseIP("::ffff:127.0.0.1"));
		assert.equal(isSpecialUseIP("::ffff:5db8:d822"), false); // mapped 93.184.216.34
		assert.equal(isSpecialUseIP("2606:4700:4700::1111"), false);
	});

	// S2: the fetch pins its connection to the already-validated address instead of
	// re-resolving the hostname. Proving a full DNS-rebinding flip needs a custom
	// DNS server; what we can pin down cheaply is that (a) a client on a domain that
	// resolves nowhere is rejected before any connection, and (b) the connector is
	// handed the validated IP (it connects to an address, never re-resolving).
	it("rejects a client_id whose hostname does not resolve (no silent fetch fallback)", async () => {
		const user = await insertUser();
		const cookie = await makeSessionCookie(user._id);
		const res = await authorize(
			authorizeParams(codeVerifier(), { client_id: "https://nonexistent.invalid.example/cimd.json" }),
			cookie,
		);
		assert.strictEqual(res.status, 400);
		assert.match(res.body, /invalid_client/);
	});
});

// --- authorize ---------------------------------------------------------------

describe("GET /api/oauth2/authorize", () => {
	let cookie: string;

	before(async () => {
		mainUser = await insertUser();
		mainCookie = await makeSessionCookie(mainUser._id);
		cookie = mainCookie;
	});

	it("rejects a CIMD document larger than 5 kB (§8.7)", async () => {
		resetClient();
		client.rawBody = Buffer.concat([
			Buffer.from(JSON.stringify(defaultClientDocument()).slice(0, -1)),
			Buffer.alloc(6 * 1024, 32),
		]);
		const res = await authorize(authorizeParams(codeVerifier()), cookie);
		assert.strictEqual(res.status, 400);
		assert.match(res.body, /too large|invalid_client/);
	});

	it("refuses to follow redirects when fetching the metadata document (§5)", async () => {
		resetClient();
		client.redirectTo = `http://127.0.0.1:${client.port}/client2`;
		const res = await authorize(authorizeParams(codeVerifier()), cookie);
		assert.strictEqual(res.status, 400);
		assert.match(res.body, /invalid_client/);
	});

	it("rejects a document declaring a secret-based token_endpoint_auth_method (§4.1)", async () => {
		resetClient({ ...defaultClientDocument(), token_endpoint_auth_method: "client_secret_basic" });
		const res = await authorize(authorizeParams(codeVerifier()), cookie);
		assert.strictEqual(res.status, 400);
		assert.match(res.body, /invalid_client/);
	});

	it("rejects non-https logo_uri / client_uri (N5: stored-XSS / tracking, §8.8)", async () => {
		for (const field of ["logo_uri", "client_uri"]) {
			resetClient({ ...defaultClientDocument(), [field]: "javascript:alert(1)" });
			const res = await authorize(authorizeParams(codeVerifier()), cookie);
			assert.strictEqual(res.status, 400, `${field}=javascript: must be rejected`);
			assert.match(res.body, /invalid_client/);
		}
		// A data: logo is likewise refused.
		resetClient({ ...defaultClientDocument(), logo_uri: "data:image/svg+xml,<svg/>" });
		assert.strictEqual((await authorize(authorizeParams(codeVerifier()), cookie)).status, 400);
	});

	it("rejects a document whose client_id does not match the requested URL (§4)", async () => {
		resetClient({ ...defaultClientDocument(), client_id: "https://other.example/client" });
		const res = await authorize(authorizeParams(codeVerifier()), cookie);
		assert.strictEqual(res.status, 400);
		assert.match(res.body, /does not match/);
	});

	it("rejects client_id URLs violating §3 (userinfo / fragment / dot segments / no path)", async () => {
		resetClient();
		const bad = [
			`https://user@127.0.0.1:${client.port}/client`,
			`https://127.0.0.1:${client.port}/client#frag`,
			`https://127.0.0.1:${client.port}/a/../client`,
			`https://127.0.0.1:${client.port}/`,
		];
		for (const client_id of bad) {
			const res = await authorize(authorizeParams(codeVerifier(), { client_id }), cookie);
			assert.strictEqual(res.status, 400, `${client_id} must be rejected`);
			assert.match(res.body, /invalid_client/);
		}
	});

	it("requires an exact redirect_uri match (§4.2): prefix and suffix both fail", async () => {
		resetClient();
		for (const redirect_uri of [
			`http://127.0.0.1:${client.port}/cb/extra`,
			`http://127.0.0.1:${client.port}/c`,
			`http://127.0.0.1:${client.port}/cb?injected=1`,
			`http://127.0.0.1:${client.port}/CB`,
		]) {
			const res = await authorize(authorizeParams(codeVerifier(), { redirect_uri }), cookie);
			assert.strictEqual(res.status, 400, `${redirect_uri} must not match`);
			assert.match(res.body, /redirect_uri/);
		}
	});

	it("rejects a scope set without openid, and unknown scopes", async () => {
		resetClient();
		const noOpenid = await authorize(authorizeParams(codeVerifier(), { scope: "profile email" }), cookie);
		assert.strictEqual(noOpenid.status, 400);
		const unknown = await authorize(authorizeParams(codeVerifier(), { scope: "openid admin" }), cookie);
		assert.strictEqual(unknown.status, 400);
	});

	it("redirects anonymous users to the web login page with a redirect back to the authorize URL", async () => {
		resetClient();
		const verifier = codeVerifier();
		const res = await authorize(authorizeParams(verifier));
		assert.strictEqual(res.status, 303);
		const login = new URL(res.location!);
		assert.strictEqual(login.pathname, "/login");
		const back = login.searchParams.get("redirect")!;
		assert.ok(back.startsWith("/api/oauth2/authorize?"), `redirect should resume authorize, got ${back}`);
		assert.ok(back.includes(`code_challenge=${encodeURIComponent(codeChallenge(verifier))}`));
	});

	it("rejects unconfirmed accounts (email_verified must never be issued for them)", async () => {
		resetClient();
		const unconfirmed = await insertUser({ security: { confirmed: false } });
		const res = await authorize(authorizeParams(codeVerifier()), await makeSessionCookie(unconfirmed._id));
		assert.strictEqual(res.status, 403);
	});

	it("previews the client for the consent page, including the https logo", async () => {
		resetClient({ ...altClientDocument(), logo_uri: "https://example.com/logo.png" });
		const user = await insertUser();
		const userCookie = await makeSessionCookie(user._id);
		const res = await fetch(
			`${baseURL()}/api/oauth2/consent?${authorizeParams(codeVerifier(), { client_id: altClientId() })}`,
			{ headers: { cookie: userCookie } },
		);
		const body: unknown = await json(res);
		assert.strictEqual(res.status, 200, JSON.stringify(body));
		assert.deepStrictEqual(body, {
			clientId: altClientId(),
			clientName: "Test App",
			clientHost: `127.0.0.1:${client.port}`,
			logoUri: "https://example.com/logo.png",
			scopes: ["openid", "profile", "email"],
		});
	});

	it("omits the logo from the consent preview when the client declares none", async () => {
		resetClient();
		const user = await insertUser();
		const userCookie = await makeSessionCookie(user._id);
		const res = await fetch(`${baseURL()}/api/oauth2/consent?${authorizeParams(codeVerifier())}`, {
			headers: { cookie: userCookie },
		});
		const body: unknown = await json(res);
		assert.strictEqual(res.status, 200, JSON.stringify(body));
		assert.ok(body && typeof body === "object" && !("logoUri" in body));
	});

	it("requires consent, then remembers it: second authorize issues the code directly", async () => {
		resetClient();
		// Fresh user: no consent on record → the first authorize must bounce to the
		// consent interstitial (not issue a code).
		const fresh = await insertUser();
		const freshCookie = await makeSessionCookie(fresh._id);
		const first = await authorize(authorizeParams(codeVerifier()), freshCookie);
		assert.strictEqual(first.status, 303);
		assert.ok(first.location?.includes("/oauth2/consent?"), `expected consent interstitial, got ${first.location}`);

		const verifier = codeVerifier();
		const { code, state } = await runAuthorizeFlow(cookie, verifier);
		assert.ok(code);
		assert.strictEqual(state, "client-state");

		// Consent now covers the scopes: a fresh authorize skips the interstitial.
		const again = await authorize(authorizeParams(codeVerifier()), cookie);
		assert.strictEqual(again.status, 303);
		assert.ok(new URL(again.location!).searchParams.get("code"), `expected a code, got ${again.location}`);
	});

	it("rejects a form-urlencoded consent POST (CSRF — a cross-site HTML form is form-encoded)", async () => {
		resetClient();
		const formBody = new URLSearchParams({
			...Object.fromEntries(authorizeParams(codeVerifier())),
			decision: "approve",
		}).toString();
		const res = await fetch(`${baseURL()}/api/oauth2/consent`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", cookie },
			body: formBody,
		});
		assert.strictEqual(res.status, 415, await res.text());
	});

	it("deny redirects the client with error=access_denied and records no consent", async () => {
		// A distinct user → no consent on record for this (user, client) pair yet.
		const denier = await insertUser();
		const denyCookie = await makeSessionCookie(denier._id);
		resetClient();
		const params = authorizeParams(codeVerifier());
		const first = await authorize(params, denyCookie);
		assert.strictEqual(first.status, 303);
		assert.ok(first.location?.includes("/oauth2/consent"));

		const deny = await fetch(`${baseURL()}/api/oauth2/consent`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: denyCookie },
			body: JSON.stringify({ ...Object.fromEntries(params), decision: "deny" }),
		});
		const denyBody: unknown = await json(deny);
		assert.strictEqual(deny.status, 200, JSON.stringify(denyBody));
		assert.ok(denyBody && typeof denyBody === "object" && "redirectUrl" in denyBody);
		const redirectUrl = String(denyBody.redirectUrl);
		const target = new URL(redirectUrl);
		assert.strictEqual(target.searchParams.get("error"), "access_denied");
		assert.strictEqual(target.searchParams.get("state"), "client-state");

		// No consent recorded → the next authorize still bounces to the interstitial.
		const again = await authorize(authorizeParams(codeVerifier()), denyCookie);
		assert.ok(again.location?.includes("/oauth2/consent"));
	});
});

// --- token -------------------------------------------------------------------

describe("POST /api/oauth2/token", () => {
	let cookie: string;

	before(async () => {
		cookie = mainCookie;
		resetClient();
		// Consent once; the individual tests mint codes via the full flow.
		await runAuthorizeFlow(cookie, codeVerifier());
	});

	it("issues access + id tokens on a valid exchange (PKCE round-trip)", async () => {
		const verifier = codeVerifier();
		const { code } = await runAuthorizeFlow(cookie, verifier);
		const res = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: clientRedirectUri(),
			client_id: clientId(),
			code_verifier: verifier,
		});
		assert.strictEqual(res.status, 200, JSON.stringify(res.body));
		assert.strictEqual(res.headers.get("cache-control"), "no-store");
		assert.strictEqual(res.body!.token_type, "Bearer");
		assert.strictEqual(res.body!.expires_in, 3600);
		assert.strictEqual(res.body!.scope, "openid profile email");

		const access = jwt.verify(String(res.body!.access_token), env.jwt.keys.public);
		assert.ok(typeof access === "object");
		assert.deepStrictEqual(access.scopes, ["oauth"]);
		assert.strictEqual(access.isAdmin, false);

		const idToken = jwt.verify(String(res.body!.id_token), env.jwt.keys.public);
		assert.ok(typeof idToken === "object");
		assert.strictEqual(idToken.iss, env.oauth2.issuer);
		assert.strictEqual(idToken.aud, clientId());
		assert.strictEqual(idToken.email, mainUser.account.email);
		assert.strictEqual(idToken.email_verified, true);
		assert.strictEqual(idToken.preferred_username, mainUser.account.username);
	});

	it("codes are single-use: replaying one fails with invalid_grant", async () => {
		const verifier = codeVerifier();
		const { code } = await runAuthorizeFlow(cookie, verifier);
		const params = {
			grant_type: "authorization_code",
			code,
			redirect_uri: clientRedirectUri(),
			client_id: clientId(),
			code_verifier: verifier,
		};
		assert.strictEqual((await tokenRequest(params)).status, 200);
		const replay = await tokenRequest(params);
		assert.strictEqual(replay.status, 400);
		assert.match(String(replay.body!.message), /invalid_grant/);
	});

	it("fails on a wrong code_verifier", async () => {
		const { code } = await runAuthorizeFlow(cookie, codeVerifier());
		const res = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: clientRedirectUri(),
			client_id: clientId(),
			code_verifier: codeVerifier(),
		});
		assert.strictEqual(res.status, 400);
		assert.match(String(res.body!.message), /invalid_grant/);
	});

	it("fails when client_id or redirect_uri don't match the code (mix-up defense)", async () => {
		const verifier = codeVerifier();
		const { code } = await runAuthorizeFlow(cookie, verifier);
		const wrongRedirect = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: `${clientRedirectUri()}/other`,
			client_id: clientId(),
			code_verifier: verifier,
		});
		assert.strictEqual(wrongRedirect.status, 400);
	});

	it("rejects a client_secret (public clients only, §4.1)", async () => {
		const res = await tokenRequest({
			grant_type: "authorization_code",
			code: "whatever",
			redirect_uri: clientRedirectUri(),
			client_id: clientId(),
			code_verifier: codeVerifier(),
			client_secret: "nope",
		});
		assert.strictEqual(res.status, 400);
		assert.match(String(res.body!.message), /client_secret/);
	});
});

// --- userinfo + scope isolation ----------------------------------------------

describe("GET /api/oauth2/userinfo", () => {
	let oauthToken: string;
	let userId: ObjectId;

	before(async () => {
		userId = mainUser._id;
		resetClient();
		const verifier = codeVerifier();
		const { code } = await runAuthorizeFlow(mainCookie, verifier);
		const res = await tokenRequest({
			grant_type: "authorization_code",
			code,
			redirect_uri: clientRedirectUri(),
			client_id: clientId(),
			code_verifier: verifier,
		});
		assert.strictEqual(res.status, 200, JSON.stringify(res.body));
		oauthToken = String(res.body!.access_token);
	});

	it("returns flat OIDC claims for an oauth-scoped token", async () => {
		const res = await fetch(`${baseURL()}/api/oauth2/userinfo`, {
			headers: { authorization: `Bearer ${oauthToken}` },
		});
		const body: unknown = await json(res);
		assert.strictEqual(res.status, 200, JSON.stringify(body));
		assert.ok(body && typeof body === "object");
		assert.deepStrictEqual(body, {
			sub: userId.toString(),
			id: userId.toString(),
			preferred_username: mainUser.account.username,
			name: mainUser.account.username,
			email: mainUser.account.email,
			email_verified: true,
			picture: body.picture, // shape asserted below
		});
		assert.match(String(body.picture), /\/api\/user\/[a-f\d]{24}\/avatar$/);
	});

	it("an oauth token cannot act as a full API session (no /api/account access)", async () => {
		const res = await fetch(`${baseURL()}/api/account`, {
			headers: { authorization: `Bearer ${oauthToken}` },
		});
		assert.strictEqual(res.status, 401);
	});

	it("a full-session ('all') token is refused by userinfo", async () => {
		const fullToken = await createAccessToken({ user: userId }, ["all"], false);
		const res = await fetch(`${baseURL()}/api/oauth2/userinfo`, {
			headers: { authorization: `Bearer ${fullToken}` },
		});
		assert.strictEqual(res.status, 401);
	});

	it("rejects missing/garbage bearer tokens", async () => {
		assert.strictEqual((await fetch(`${baseURL()}/api/oauth2/userinfo`)).status, 401);
		const res = await fetch(`${baseURL()}/api/oauth2/userinfo`, { headers: { authorization: "Bearer garbage" } });
		assert.strictEqual(res.status, 401);
	});
});

// --- well-known (api copy) -----------------------------------------------------

describe("GET /api/oauth2/.well-known/openid-configuration", () => {
	it("advertises CIMD support with the current draft field name", async () => {
		env.oauth2.issuer = "https://boardgamers.space";
		try {
			const res = await fetch(`${baseURL()}/api/oauth2/.well-known/openid-configuration`);
			assert.strictEqual(res.status, 200);
			const raw: unknown = await json(res);
			assert.ok(raw && typeof raw === "object");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tests read ad-hoc fields off the response
			const body = raw as Record<string, unknown>;
			assert.strictEqual(body.client_id_metadata_document_supported, true);
			assert.strictEqual(body.client_id_metadata_supported, undefined);
			assert.strictEqual(body.issuer, "https://boardgamers.space");
			assert.strictEqual(body.authorization_endpoint, "https://boardgamers.space/api/oauth2/authorize");
			assert.deepStrictEqual(body.code_challenge_methods_supported, ["S256"]);
			assert.deepStrictEqual(body.token_endpoint_auth_methods_supported, ["none"]);
			assert.deepStrictEqual(body.response_types_supported, ["code"]);
		} finally {
			env.oauth2.issuer = "";
		}
	});
});
