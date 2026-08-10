import crypto from "node:crypto";
import { z } from "zod";
import { logEvent } from "@bgs/utils/log";
import { createOAuthState, verifyOAuthState } from "../models/oauthflows.ts";

/**
 * Hand-rolled PKCE OAuth 2.0 for public clients (GitHub, Hugging Face).
 *
 * No passport, no client secret — just two HTTP calls and a redirect:
 *   1. pkceStart()  → builds the authorize URL with S256 challenge, stores the
 *      verifier server-side (Mongo, single-use), returns the URL to redirect to.
 *   2. pkceCallback() → verifies the state handle, exchanges code+verifier for
 *      an access token, fetches the user profile, returns it.
 */

const STATE_TTL_MS = 15 * 60 * 1000;

function base64url(buf: Buffer): string {
	return buf.toString("base64url");
}

function generateVerifier(): string {
	return base64url(crypto.randomBytes(32));
}

function computeChallenge(verifier: string): string {
	return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export type PkceProviderConfig = {
	authorizationUrl: string;
	tokenUrl: string;
	userinfoUrl: string;
	scope: string[];
	/** Map the provider's userinfo JSON to our SocialProfile shape. */
	parseUserinfo: (json: unknown) => { id: string; username?: string; profileUrl?: string };
};

export type PkceStartResult = {
	/** The URL to redirect the browser to. */
	url: string;
};

/** Start a PKCE flow: generate verifier+challenge, store state, build the authorize URL. */
export async function pkceStart(
	config: PkceProviderConfig,
	clientId: string,
	redirectUri: string,
): Promise<PkceStartResult> {
	const verifier = generateVerifier();
	const challenge = computeChallenge(verifier);

	const state = await createOAuthState({
		codeVerifier: verifier,
		expiresAt: new Date(Date.now() + STATE_TTL_MS),
	});

	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: config.scope.join(" "),
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	});

	return { url: `${config.authorizationUrl}?${params}` };
}

const tokenResponseSchema = z.object({
	access_token: z.string(),
});

/**
 * Complete a PKCE flow: verify the state, exchange the code for a token,
 * fetch the user profile. Returns the SocialProfile on success, null on failure.
 */
export async function pkceCallback(
	config: PkceProviderConfig,
	clientId: string,
	redirectUri: string,
	code: string,
	state: string,
): Promise<{ id: string; username?: string; profileUrl?: string } | null> {
	const provider = config.authorizationUrl.includes("github") ? "github" : "huggingface";

	// Single-use state verification (deletes the doc).
	const verifier = await verifyOAuthState(state);
	if (!verifier) {
		logEvent("warn", "pkce-state-invalid", { source: "api", provider, state });
		return null;
	}

	// Exchange the authorization code for an access token (PKCE: no client_secret).
	const tokenRes = await fetch(config.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			redirect_uri: redirectUri,
			code,
			code_verifier: verifier,
		}),
	});

	if (!tokenRes.ok) {
		const body = await tokenRes.text().catch(() => "");
		logEvent("warn", "pkce-token-exchange-failed", {
			source: "api",
			provider,
			status: tokenRes.status,
			body: body.slice(0, 500),
		});
		return null;
	}

	const tokenJson: unknown = await tokenRes.json();
	const parsed = tokenResponseSchema.safeParse(tokenJson);
	if (!parsed.success) {
		logEvent("warn", "pkce-token-parse-failed", {
			source: "api",
			provider,
			body: JSON.stringify(tokenJson).slice(0, 500),
		});
		return null;
	}

	// Fetch the user profile with the access token.
	const userinfoRes = await fetch(config.userinfoUrl, {
		headers: { Authorization: `Bearer ${parsed.data.access_token}`, Accept: "application/json" },
	});

	if (!userinfoRes.ok) {
		const body = await userinfoRes.text().catch(() => "");
		logEvent("warn", "pkce-userinfo-failed", {
			source: "api",
			provider,
			status: userinfoRes.status,
			body: body.slice(0, 500),
		});
		return null;
	}

	const userinfoJson: unknown = await userinfoRes.json();
	try {
		return config.parseUserinfo(userinfoJson);
	} catch (err) {
		logEvent("warn", "pkce-userinfo-parse-failed", {
			source: "api",
			provider,
			error: err instanceof Error ? err.message : String(err),
			body: JSON.stringify(userinfoJson).slice(0, 500),
		});
		return null;
	}
}

// --- Provider configs ---

export const githubConfig: PkceProviderConfig = {
	authorizationUrl: "https://github.com/login/oauth/authorize",
	tokenUrl: "https://github.com/login/oauth/access_token",
	userinfoUrl: "https://api.github.com/user",
	scope: ["read:user"],
	parseUserinfo: (json) => {
		const parsed = z
			.object({
				id: z.union([z.string(), z.number()]).transform(String),
				login: z.string().optional(),
				html_url: z.string().optional(),
			})
			.parse(json);
		return { id: parsed.id, username: parsed.login, profileUrl: parsed.html_url };
	},
};

export const huggingfaceConfig: PkceProviderConfig = {
	authorizationUrl: "https://huggingface.co/oauth/authorize",
	tokenUrl: "https://huggingface.co/oauth/token",
	userinfoUrl: "https://huggingface.co/oauth/userinfo",
	scope: ["openid", "profile"],
	parseUserinfo: (json) => {
		const parsed = z
			.object({
				sub: z.union([z.string(), z.number()]).transform(String),
				preferred_username: z.string().optional(),
			})
			.parse(json);
		return {
			id: parsed.sub,
			username: parsed.preferred_username,
			profileUrl: parsed.preferred_username ? `https://huggingface.co/${parsed.preferred_username}` : undefined,
		};
	},
};
