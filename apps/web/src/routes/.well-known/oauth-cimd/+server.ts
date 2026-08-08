import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * CIMD — Client ID Metadata Document (draft-ietf-oauth-client-id-metadata-document).
 *
 * Hugging Face supports CIMD (its OIDC config advertises
 * `client_id_metadata_document_supported: true`), which lets the site be its own OAuth
 * client WITHOUT pre-registering an OAuth app: the `client_id` is this document's URL,
 * and HF fetches it to learn/validate the client. CIMD forbids shared-secret auth, so
 * this is a public PKCE client (`token_endpoint_auth_method: "none"`).
 *
 * The doc is derived from the request Host, so every environment (prod + each PR
 * preview) automatically serves a doc naming its OWN origin as both `client_id` and
 * `redirect_uris` — which is exactly what removes the registered-redirect problem for
 * HF (no prod callback relay needed). This endpoint must be reachable over HTTPS on the
 * public origin for HF to fetch it; it requires no env/configuration.
 */
export const GET: RequestHandler = ({ url }) => {
	const clientId = `${url.origin}/.well-known/oauth-cimd`;
	return json(
		{
			client_id: clientId,
			client_name: "Boardgamers",
			// Shown on HF's consent screen. Depends on #140 (og-logo-icon), which adds
			// apps/web/static/logo.png — until that lands on main this 404s (HF just skips it).
			logo_uri: `${url.origin}/logo.png`,
			redirect_uris: [`${url.origin}/auth/huggingface/callback`],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			// Public client: PKCE only, no shared secret (CIMD forbids secret-based auth).
			token_endpoint_auth_method: "none",
			scope: "openid profile",
		},
		{
			headers: {
				// Cacheable: HF caches per HTTP cache headers. Short-ish so envs can change.
				"cache-control": "public, max-age=3600",
			},
		},
	);
};
