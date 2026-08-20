import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { ObjectId, type WithId } from "mongodb";
import type { OAuthScope, UserDoc } from "@bgs/models";
import { colls } from "../../config/db.ts";
import { env } from "../../config/index.ts";
import { verifyPkceS256 } from "../../config/pkce.ts";
import { userRoles } from "@bgs/models";
import { createAccessToken, accessTokenDuration } from "../../models/jwtrefreshtokens.ts";
import { createOAuthCode, redeemOAuthCode } from "../../models/oauthflows.ts";
import { missingConsentScopes, recordConsent, touchConsent } from "../../models/oauthconsents.ts";
import { getClientMetadata, isRegisteredRedirectUri } from "../../services/cimd.ts";

/**
 * The API as an OAuth2/OIDC *provider* (issue #76), for CIMD clients: the
 * `client_id` is a URL hosting a Client ID Metadata Document, there are no
 * registered clients and NO client secrets — PKCE (S256) replaces client auth
 * (§4.1 of draft-ietf-oauth-client-id-metadata-document).
 *
 * Consent is REQUIRED: CIMD clients are self-asserted, so unlike the
 * trusted-first-party design of #196 every client goes through the consent
 * screen — except first-party trusted clients listed in
 * `env.oauth2.trustedClients` (e.g. the forum), and ones with `trusted: true`
 * on their recorded consent doc (the out-of-band escape hatch).
 */

const CODE_TTL_MS = 10 * 60 * 1000;

/** Scopes a CIMD client may request. */
const SUPPORTED_SCOPES: OAuthScope[] = ["openid", "profile", "email", "role"];

// Scope minted into OAuth access tokens. Never "all": the app bearer middleware
// only authenticates scope-"all" tokens as users, so a leaked OAuth token can't
// act as an API session — and userinfo requires this scope, so a full session
// access token can't be replayed against userinfo either.
const OAUTH_TOKEN_SCOPE = "oauth";

function parseScopes(scope: string): OAuthScope[] {
	const scopes = [...new Set(scope.split(/\s+/).filter(Boolean))];
	if (!scopes.includes("openid")) {
		throw createError(400, 'invalid_scope: the "openid" scope is required');
	}
	const unsupported = scopes.filter(
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership test IS the validation
		(s) => !SUPPORTED_SCOPES.includes(s as OAuthScope),
	);
	if (unsupported.length > 0) {
		throw createError(400, `invalid_scope: unsupported scope(s): ${unsupported.join(", ")}`);
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every element was validated against SUPPORTED_SCOPES above
	return scopes as OAuthScope[];
}

// client_id/redirect_uri stay bare strings here: their real validation is the
// CIMD layer (validateClientIdUrl enforces §3; redirect_uris exact-match §4.2),
// which also yields the OAuth-style error messages. Same for prompt: pass any
// value through (OIDC Core §3.1.2.1), only "none" changes behavior below.
const authorizeQuerySchema = z.object({
	client_id: z.string(),
	redirect_uri: z.string(),
	response_type: z.literal("code"),
	scope: z.string().min(1),
	state: z.string().max(1024).optional(),
	code_challenge: z.string().min(43).max(128),
	code_challenge_method: z.literal("S256"),
	prompt: z.string().optional(),
});

type AuthorizeParams = z.infer<typeof authorizeQuerySchema>;

/**
 * Validate client + redirect URI against the CIMD document and return the
 * validated client metadata. Runs before any session/consent check so a bogus
 * client_id or redirect_uri fails fast without involving the user.
 */
async function validateClientRequest(params: Pick<AuthorizeParams, "client_id" | "redirect_uri">) {
	let metadata;
	try {
		metadata = await getClientMetadata(params.client_id);
	} catch (err) {
		throw createError(400, `invalid_client: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!isRegisteredRedirectUri(metadata, params.redirect_uri)) {
		throw createError(400, "invalid_request: redirect_uri is not one of the client's registered redirect URIs");
	}
	return metadata;
}

function redirectToWeb(ctx: Context, path: string) {
	// Absolute redirects to the web app — it lives on the same origin as the API in
	// production (nginx routes /api/*), but on its own port in dev. 303 See Other,
	// the OAuth-correct status for these handoffs.
	ctx.status = 303;
	ctx.redirect(`${env.webAppUrl}${path}`);
}

// A user reaching us via OAuth (forum / Grafana SSO) was "seen". Bump
// security.lastSeen — the cleanup's activity field for SSO-only users — plus the
// consent's lastUsedAt trace. Fire-and-forget, throttled to ~1 write/day per user
// (reads lastSeen off the already-loaded ctx.state.user, mirroring the
// sliding-session throttle in app.ts). Never touches security.lastLogin: an OAuth
// authorization is not a site login.
function markSeenViaOAuth(user: WithId<UserDoc>, clientId: string) {
	const lastSeen = user.security.lastSeen?.getTime() ?? 0;
	if (Date.now() - lastSeen < 24 * 3600 * 1000) {
		return;
	}
	Promise.all([
		colls.users.updateOne({ _id: user._id }, { $set: { "security.lastSeen": new Date() } }),
		touchConsent(user._id, clientId),
	]).catch(console.error);
}

async function issueCodeAndRedirect(
	ctx: Context,
	params: AuthorizeParams,
	user: WithId<UserDoc>,
	scopes: OAuthScope[],
) {
	markSeenViaOAuth(user, params.client_id);
	const code = await createOAuthCode({
		clientId: params.client_id,
		redirectUri: params.redirect_uri,
		user: user._id,
		scopes,
		codeChallenge: params.code_challenge,
		codeChallengeMethod: "S256",
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});
	const url = new URL(params.redirect_uri);
	url.searchParams.set("code", code);
	if (params.state !== undefined) {
		url.searchParams.set("state", params.state);
	}
	ctx.status = 303;
	ctx.redirect(url.toString());
}

/** Authorization-error redirect to the client's redirect_uri (RFC6749 §4.1.2.1 / OIDC Core §3.1.2.6). */
function errorAndRedirect(ctx: Context, params: AuthorizeParams, error: string, description: string) {
	const url = new URL(params.redirect_uri);
	url.searchParams.set("error", error);
	url.searchParams.set("error_description", description);
	if (params.state !== undefined) {
		url.searchParams.set("state", params.state);
	}
	ctx.status = 303;
	ctx.redirect(url.toString());
}

const router = new Router<Application.DefaultState, Context>();

router.get("/authorize", async (ctx) => {
	const params = authorizeQuerySchema.parse(ctx.query);
	const scopes = parseScopes(params.scope);
	await validateClientRequest(params);

	const user = ctx.state.user;
	if (!user) {
		// prompt=none forbids any interactive step (OIDC Core §3.1.2.6): answer
		// in-band on the client's redirect_uri instead of bouncing to web login.
		if (params.prompt === "none") {
			errorAndRedirect(ctx, params, "login_required", "The user is not authenticated");
			return;
		}
		// Back to the authorize URL after login (web's login flow honours the
		// same-origin ?redirect= param; /api/... is same-origin on the site).
		const back = encodeURIComponent(ctx.originalUrl);
		redirectToWeb(ctx, `/login?redirect=${back}`);
		return;
	}
	// email_verified must never be emitted for an unproven address, and the
	// userinfo claim set is built around it — so unconfirmed users stop here, with
	// the same gate the game routes use.
	if (!user.security.confirmed) {
		throw createError(403, "You need to confirm your account before authorizing applications");
	}

	// Consent: required for every client unless the recorded doc flags it trusted
	// or the client is a first-party trusted one (env.oauth2.trustedClients).
	const missing = await missingConsentScopes(user._id, params.client_id, scopes);
	if (missing.length > 0) {
		if (params.prompt === "none") {
			errorAndRedirect(
				ctx,
				params,
				"interaction_required",
				"The user has not granted consent for the requested scopes",
			);
			return;
		}
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(ctx.query)) {
			if (typeof value === "string") {
				query.set(key, value);
			}
		}
		redirectToWeb(ctx, `/oauth2/consent?${query.toString()}`);
		return;
	}

	await issueCodeAndRedirect(ctx, params, user, scopes);
});

/**
 * Consent preview: the web consent page calls this to render the client name and
 * requested scopes. Session-auth (cookie) only.
 */
router.get("/consent", async (ctx) => {
	if (!ctx.state.user) {
		throw createError(401, "You need to be logged in");
	}
	const params = authorizeQuerySchema.parse(ctx.query);
	const scopes = parseScopes(params.scope);
	const metadata = await validateClientRequest(params);
	ctx.body = {
		clientId: params.client_id,
		clientName: metadata.client_name,
		clientHost: new URL(params.client_id).host,
		// Guaranteed https (or absent) by the CIMD document schema — safe to render.
		...(metadata.logo_uri ? { logoUri: metadata.logo_uri } : {}),
		scopes,
	};
});

/** Approve or deny. On approve: record consent and hand back the authorize URL to resume. */
// CSRF: covered by the global cookie-CSRF middleware in app.ts (cookie-authed
// mutations must be JSON + not cross-site) — no per-route gate needed here.
router.post("/consent", async (ctx) => {
	if (!ctx.state.user) {
		throw createError(401, "You need to be logged in");
	}
	const body = authorizeQuerySchema.extend({ decision: z.enum(["approve", "deny"]) }).parse(ctx.request.body);
	const scopes = parseScopes(body.scope);
	await validateClientRequest(body);

	if (body.decision === "approve") {
		await recordConsent(ctx.state.user._id, body.client_id, scopes);
		const query = new URLSearchParams({
			client_id: body.client_id,
			redirect_uri: body.redirect_uri,
			response_type: body.response_type,
			scope: body.scope,
			code_challenge: body.code_challenge,
			code_challenge_method: body.code_challenge_method,
			...(body.state !== undefined ? { state: body.state } : {}),
		});
		ctx.body = { authorizeUrl: `/api/oauth2/authorize?${query.toString()}` };
		return;
	}

	// Deny: tell the client, per RFC6749 §4.1.2.1.
	const url = new URL(body.redirect_uri);
	url.searchParams.set("error", "access_denied");
	url.searchParams.set("error_description", "The resource owner denied the request");
	if (body.state !== undefined) {
		url.searchParams.set("state", body.state);
	}
	ctx.body = { redirectUrl: url.toString() };
});

// Non-credential placeholder for OAuth clients that unconditionally send a
// client_secret (Grafana's generic-oauth always does). Tolerated at the token
// endpoint — and accepted for nothing else: PKCE remains the only client-auth
// mechanism, and this value must never be treated as authentication.
export const OAUTH_PLACEHOLDER_CLIENT_SECRET = "__UNUSED__";

const tokenBodySchema = z
	.object({
		grant_type: z.literal("authorization_code"),
		code: z.string().min(1),
		redirect_uri: z.string(),
		client_id: z.string(),
		// RFC7636 §4.1
		code_verifier: z.string().min(43).max(128),
		// Declared only so the placeholder isn't stripped by .strict() — never read
		// afterwards; real secrets are rejected by the raw-body check below.
		client_secret: z.literal(OAUTH_PLACEHOLDER_CLIENT_SECRET).optional(),
	})
	.strict();

router.post("/token", async (ctx) => {
	// Public clients only (CIMD §4.1): a client_secret must never be used — reject
	// it explicitly rather than silently ignoring it. Sole tolerance: Grafana (and
	// some other generic-oauth clients) always send one, so the known placeholder
	// `__UNUSED__` is accepted and ignored; any other value is a real secret and
	// still violates §4.1.
	const clientSecret = new URLSearchParams(ctx.request.rawBody).get("client_secret");
	if (clientSecret !== null && clientSecret !== OAUTH_PLACEHOLDER_CLIENT_SECRET) {
		throw createError(
			400,
			`invalid_client: CIMD clients are public — no client_secret (PKCE only). If your client requires one, set it to "${OAUTH_PLACEHOLDER_CLIENT_SECRET}".`,
		);
	}
	const body = tokenBodySchema.parse(ctx.request.body);

	const metadata = await (async () => {
		try {
			return await getClientMetadata(body.client_id);
		} catch (err) {
			throw createError(400, `invalid_client: ${err instanceof Error ? err.message : String(err)}`);
		}
	})();
	if (!isRegisteredRedirectUri(metadata, body.redirect_uri)) {
		throw createError(400, "invalid_grant: redirect_uri is not registered for this client");
	}

	// Single-use: a replayed code is already gone.
	const code = await redeemOAuthCode(body.code);
	if (!code || code.clientId !== body.client_id || code.redirectUri !== body.redirect_uri) {
		throw createError(400, "invalid_grant: unknown or mismatched authorization code");
	}
	if (!verifyPkceS256(body.code_verifier, code.codeChallenge)) {
		throw createError(400, "invalid_grant: PKCE verification failed");
	}

	const user = await colls.users.findOne({ _id: code.user });
	if (!user) {
		throw createError(400, "invalid_grant: the authorizing user no longer exists");
	}
	// The lastSeen bump happens once per flow, at code issuance (authorize). Here we
	// only refresh the consent trace — bumping lastSeen from the freshly re-read user
	// would race authorize's fire-and-forget write and double-write.
	touchConsent(user._id, body.client_id).catch(console.error);

	// Not user.isAdmin on purpose: the OAuth token is an identity credential for
	// third-party clients, not an admin credential — keep admin gating on the
	// session-token family (the admin UI never accepts oauth-scoped tokens anyway).
	const accessToken = await createAccessToken({ user: user._id }, [OAUTH_TOKEN_SCOPE, ...code.scopes], false);
	const idToken = signIdToken(user, body.client_id, code.scopes);

	ctx.set("Cache-Control", "no-store");
	ctx.set("Pragma", "no-cache");
	ctx.body = {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: accessTokenDuration() / 1000,
		scope: code.scopes.join(" "),
		id_token: idToken,
	};
});

/** OIDC ID token: same signing key/algorithm as the rest of the API (RS256 in prod, HS256 in dev). */
function signIdToken(user: WithId<UserDoc>, clientId: string, scopes: OAuthScope[]) {
	const nowS = Math.floor(Date.now() / 1000);
	const claims: Record<string, unknown> = {
		iss: env.oauth2.issuer,
		sub: user._id.toString(),
		aud: clientId,
		iat: nowS,
		exp: nowS + accessTokenDuration() / 1000,
	};
	if (scopes.includes("profile")) {
		claims.preferred_username = user.account.username;
		claims.name = user.account.username;
	}
	// Social signups (#211) can have no email: never emit email_verified for an
	// absent address.
	if (scopes.includes("email") && user.account.email) {
		claims.email = user.account.email;
		// authorize is gated on security.confirmed — a token only exists for a
		// proven address.
		claims.email_verified = true;
	}
	// Role signal for first-party tooling (Grafana role mapping, NodeBB
	// assignGroups), NOT an admin grant: admin API access stays gated on the
	// session-token family. Standard `roles` array form. Full admins keep the
	// legacy ["admin"]; scoped admins expose their granular grants.
	if (scopes.includes("role")) {
		const roles = userRoles(user);
		if (roles.length > 0) {
			claims.roles = roles;
		}
	}
	return jwt.sign(claims, env.jwt.keys.private, { algorithm: env.jwt.algorithm });
}

router.get("/userinfo", async (ctx) => {
	const auth = ctx.get("Authorization");
	const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
	if (!token) {
		ctx.set("WWW-Authenticate", 'Bearer realm="userinfo"');
		throw createError(401, "missing Bearer token");
	}

	let userId: string;
	let scopes: string[];
	try {
		const decoded = jwt.verify(token, env.jwt.keys.public, { algorithms: [env.jwt.algorithm] });
		const payload = z.object({ userId: z.string(), scopes: z.array(z.string()) }).parse(decoded);
		if (!payload.scopes.includes(OAUTH_TOKEN_SCOPE)) {
			// A full-session ("all") token is not an OAuth grant token.
			throw new Error("wrong token scope");
		}
		userId = payload.userId;
		scopes = payload.scopes;
	} catch {
		ctx.set("WWW-Authenticate", 'Bearer realm="userinfo", error="invalid_token"');
		throw createError(401, "invalid access token");
	}

	const user = await colls.users.findOne({ _id: new ObjectId(userId) });
	if (!user) {
		throw createError(401, "invalid access token");
	}

	// Flat claims, exactly what nodebb-plugin-sso-oauth2-multiple / Grafana parse.
	// id + display name + email must all be truthy for those clients. Email claims
	// are emitted only when the user actually HAS an email (social signups from
	// #211 may not) — emitting email_verified for an absent address would be a
	// lie; email-less users will simply not authenticate on those clients.
	ctx.body = {
		sub: user._id.toString(),
		id: user._id.toString(),
		preferred_username: user.account.username,
		name: user.account.username,
		...(user.account.email
			? {
					// authorize is gated on security.confirmed — a present address is proven.
					email: user.account.email,
					email_verified: true,
				}
			: {}),
		// Role signal for first-party tooling (Grafana role_attribute_path, NodeBB
		// assignGroups reads profile.roles), NOT an admin grant: admin API access
		// stays gated on the session-token family. The grant's scopes ride the
		// access token (minted at /token) so userinfo gates the claim on them, like
		// signIdToken does. Regular users have no authority field nor adminGrants
		// (migration 1.4.2 $unset the legacy "user" placeholder), hence no roles
		// claim. Full admins keep the legacy ["admin"]; scoped admins expose grants.
		...(scopes.includes("role") && userRoles(user).length > 0 ? { roles: userRoles(user) } : {}),
		picture: `${env.oauth2.issuer}/api/user/${user._id.toString()}/avatar`,
	};
});

/**
 * OIDC discovery. Also served at the SITE ROOT (/.well-known/openid-configuration)
 * by the web app (same handler logic lives here so nginx can alternatively route
 * the well-known path straight to the API).
 */
router.get("/.well-known/openid-configuration", (ctx) => {
	if (!env.oauth2.issuer) {
		// Non-production default has no canonical origin — configure oauth2Issuer.
		throw createError(404, "OIDC discovery is not configured on this instance");
	}
	ctx.body = openidConfiguration();
	ctx.set("Cache-Control", "public, max-age=3600");
});

export function openidConfiguration() {
	const issuer = env.oauth2.issuer;
	const base = `${issuer}/api/oauth2`;
	return {
		issuer,
		authorization_endpoint: `${base}/authorize`,
		token_endpoint: `${base}/token`,
		userinfo_endpoint: `${base}/userinfo`,
		scopes_supported: SUPPORTED_SCOPES,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
		// Only "none" has behavioral effect — don't advertise values whose
		// semantics (forced re-auth / forced consent) aren't implemented.
		prompt_values_supported: ["none"],
		subject_types_supported: ["public"],
		id_token_signing_alg_values_supported: [env.jwt.algorithm],
		claims_supported: ["sub", "id", "preferred_username", "name", "email", "email_verified", "picture", "roles"],
		// §6: signal CIMD support (current draft name — the older
		// "client_id_metadata_supported" is from an outdated draft revision).
		client_id_metadata_document_supported: true,
	};
}

export default router;
