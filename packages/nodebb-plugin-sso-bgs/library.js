"use strict";

const nconf = nodebb.require("nconf");
const winston = nodebb.require("winston");

/**
 * Boardgamers SSO (issue #196): a thin shim over nodebb-plugin-sso-oauth2-multiple.
 *
 * The stock plugin is unusable against our OAuth2/OIDC provider
 * (apps/api/app/routes/oauth2) for two reasons, both in how it drives passport:
 *  - it never passes `pkce: true`/`state: true` to the strategy, while our
 *    provider REQUIRES PKCE S256 (code_challenge on /authorize, code_verifier
 *    on /token);
 *  - node-oauth's getOAuthAccessToken always serializes a client_secret key,
 *    which our provider rejects (public CIMD clients: PKCE only, no secrets).
 *
 * So we re-drive the same strategy wiring with PKCE on and a client_secret-free
 * token POST, and delegate profile parsing / login / account-linking to the
 * stock plugin (`parseUserReturn` + `OAuth.login`: lookup by `boardgamersId`,
 * else link by verified email, else create the user).
 */

// The strategy this shim manages — matches the strategy `name` entered in the
// sso-oauth2-multiple ACP page, i.e. routes /auth/boardgamers[+/callback].
const STRATEGY_NAME = "boardgamers";

const Shim = module.exports;

function stockPlugin() {
	// Resolved at call time (its module uses the global `nodebb` at load time).
	// eslint-disable-next-line global-require
	return require("nodebb-plugin-sso-oauth2-multiple/library.js");
}

/**
 * Serve the OAuth Client ID Metadata Document. It must be available at EXACTLY
 * the URL used as client_id (CIMD §4: exact string match) — nconf url + this
 * path are kept in sync with static/client-metadata.json.
 */
Shim.init = async ({ router }) => {
	router.get("/client-metadata.json", (req, res) => {
		res
			.status(200)
			.type("application/json")
			.sendFile("client-metadata.json", { root: `${__dirname}/static` });
	});
};

/**
 * filter:auth.init, registered at priority 4 so it runs BEFORE
 * sso-oauth2-multiple's own loadStrategies (default priority 10): passport
 * handlers are tried in registration order, so our PKCE strategy wins for
 * /auth/boardgamers while the stock plugin still pushes the login-button
 * descriptor (we don't) — the button url /auth/boardgamers then lands on us.
 */
Shim.loadStrategies = async (strategies) => {
	const OAuth = stockPlugin();
	const config = await OAuth.getStrategy(STRATEGY_NAME);
	if (!config || !config.enabled) {
		return strategies;
	}

	const { OAuth2Strategy } = require("passport-oauth"); // eslint-disable-line global-require
	const strategy = new OAuth2Strategy(
		{
			authorizationURL: config.authUrl,
			tokenURL: config.tokenUrl,
			clientID: config.id,
			callbackURL: config.callbackUrl || `${nconf.get("url")}/auth/${STRATEGY_NAME}/callback`,
			passReqToCallback: true,
			// Public client: PKCE S256 replaces client auth. `state: true` is
			// required by passport-oauth2 for PKCE (session store keeps the
			// verifier + a CSRF state handle).
			pkce: true,
			state: true,
		},
		async (req, token, secret, profile, done) => {
			const { id, displayName, email, email_verified } = profile;
			if (![id, displayName, email].every(Boolean)) {
				return done(new Error("insufficient-scope"));
			}
			try {
				const user = await OAuth.login({
					name: STRATEGY_NAME,
					oAuthid: id,
					handle: displayName,
					email,
					email_verified,
				});
				winston.verbose(`[plugin/sso-bgs] Successful login to uid ${user.uid} (remote id ${id})`);
				done(null, user);
			} catch (err) {
				done(err);
			}
		},
	);

	// Reuse the stock plugin's userinfo fetch + claim normalization.
	strategy.userProfile = OAuth.getUserProfile.bind(strategy, STRATEGY_NAME, config.userRoute);
	// node-oauth always serializes a `client_secret` key (even with the secret
	// undefined it sends `client_secret=`, which our provider rejects) — replace
	// the exchange so no client_secret is sent at all (public client).
	strategy._oauth2.getOAuthAccessToken = publicClientTokenExchange;

	require("passport").use(STRATEGY_NAME, strategy); // eslint-disable-line global-require
	return strategies;
};

/**
 * node-oauth OAuth2#getOAuthAccessToken, minus client_secret. The token POST is
 * exactly grant_type + code + redirect_uri + client_id + code_verifier, as our
 * provider requires of public CIMD clients.
 */
function publicClientTokenExchange(code, params, callback) {
	// Whitelist the exact keys our provider's (strict) token schema accepts.
	const body = new URLSearchParams();
	if (params.grant_type !== undefined) {
		body.set("grant_type", params.grant_type);
	}
	if (params.redirect_uri !== undefined) {
		body.set("redirect_uri", params.redirect_uri);
	}
	if (params.code_verifier !== undefined) {
		body.set("code_verifier", params.code_verifier);
	}
	body.set("client_id", this._clientId);
	body.set(params.grant_type === "refresh_token" ? "refresh_token" : "code", code);

	fetch(this._getAccessTokenUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body,
	})
		.then(async (res) => {
			const results = await res.json().catch(() => ({}));
			if (!res.ok) {
				callback({ statusCode: res.status, data: JSON.stringify(results) });
				return;
			}
			const accessToken = results.access_token;
			const refreshToken = results.refresh_token;
			delete results.refresh_token;
			callback(null, accessToken, refreshToken, results);
		})
		.catch((err) => callback(err));
}
