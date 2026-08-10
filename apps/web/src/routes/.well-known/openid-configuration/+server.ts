import { json, error } from "@sveltejs/kit";
import { building } from "$app/environment";
import type { RequestHandler } from "./$types";

/**
 * OIDC discovery document at the SITE ROOT (#76), where relying parties look for
 * it (https://<host>/.well-known/openid-configuration) — it cannot live under
 * /api, so the web app serves it.
 *
 * S3: the issuer is a CACHED security document, so it must NOT be derived from the
 * request's Host header (a spoofed `Host: evil.com` would otherwise mint
 * `issuer: https://evil.com` and get cached `public`). The issuer comes only from
 * configuration: `oauth2Issuer`, else the site domain (`domain` env, default
 * boardgamers.space). Set `oauth2Issuer` explicitly in any non-prod env whose
 * public origin differs (PR previews, local multi-instance dev).
 *
 * The api's own copy (GET /api/oauth2/.well-known/openid-configuration) uses its
 * `oauth2Issuer` env and only answers when configured.
 */
export const GET: RequestHandler = () => {
	if (building) {
		error(404, "OIDC discovery is not available while prerendering");
	}
	const domain = process.env.domain || "boardgamers.space";
	const issuer =
		process.env.oauth2Issuer || (process.env.NODE_ENV === "production" ? `https://${domain}` : "http://localhost:8612");
	const base = `${issuer}/api/oauth2`;
	return json(
		{
			issuer,
			authorization_endpoint: `${base}/authorize`,
			token_endpoint: `${base}/token`,
			userinfo_endpoint: `${base}/userinfo`,
			scopes_supported: ["openid", "profile", "email"],
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
			subject_types_supported: ["public"],
			// Matches the api's signing algorithm (RS256 in prod, HS256 in dev).
			id_token_signing_alg_values_supported: [process.env.jwtMode === "asymmetric" ? "RS256" : "HS256"],
			claims_supported: ["sub", "id", "preferred_username", "name", "email", "email_verified", "picture"],
			// §6 of draft-ietf-oauth-client-id-metadata-document (current draft name —
			// the older "client_id_metadata_supported" is from an outdated revision).
			client_id_metadata_document_supported: true,
		},
		{
			headers: {
				"cache-control": "public, max-age=3600",
			},
		},
	);
};
