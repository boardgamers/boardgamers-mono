"use strict";

const nconf = nodebb.require("nconf");
const winston = nodebb.require("winston");
const plugins = nodebb.require("./src/plugins");
const authenticationController = nodebb.require("./src/controllers/authentication");

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
const LOGIN_URL = `/auth/${STRATEGY_NAME}`;
const CALLBACK_URL = `${LOGIN_URL}/callback`;

// Lazily-built PKCE strategy, cached by its serialized config. Built from the
// CURRENT db config at request time — see resolveStrategy for why.
let cachedStrategy = null;
let cachedConfigKey = null;
let building = null; // in-flight build promise (dedupes concurrent requests)

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
 * THE fix for the live-forum bug (authorize redirect missing code_challenge).
 *
 * Root cause: the PKCE strategy used to be built ONCE inside `filter:auth.init`,
 * which NodeBB core fires a single time per route reload (boot / plugin reload)
 * — NOT per request. If the ACP strategy config was saved after that one firing
 * (the normal order when installing the shim on a live forum — deploy+activate,
 * restart, THEN configure), the shim's handler no-oped (no config yet), while
 * the stock plugin's handler (priority 10) registered its NON-PKCE strategy on
 * the NEXT reload. `passport.use(name)` is last-write-wins, so that stale stock
 * strategy kept answering /auth/boardgamers — redirecting to authorize without
 * any code_challenge, which the PKCE-only provider 403s.
 *
 * Fix: the registered passport strategy's `authenticate` resolves the PKCE
 * strategy AT REQUEST TIME from the current db config, then runs it. It
 * therefore survives every combination of boot order, ACP save timing, and
 * `passport.use` overwrite by the stock plugin. The `filter:auth.init` hook
 * (further below) only manages the login-button descriptor and pre-warms the
 * cache; it is no longer load-bearing for logins.
 *
 * On the `this` plumbing: passport's authenticate middleware runs
 * `Object.create(registeredStrategy).authenticate(req, options)` and augments
 * that per-request delegate with redirect/success/fail/error/pass. So the
 * registered object must itself be an OAuth2Strategy whose `authenticate` runs
 * with the augmented delegate as `this`. We delegate by creating a
 * `Object.create(currentStrategy)` target and copying passport's delegation
 * methods onto it — `self = this` inside passport-oauth2 then resolves the
 * delegation methods, while `_pkceMethod`/`_oauth2`/the verify callback come
 * from `currentStrategy`.
 */
const strategy = buildWrapper();

function buildWrapper() {
	const { OAuth2Strategy } = require("passport-oauth"); // eslint-disable-line global-require
	// A placeholder instance: its own endpoints are never used for a redirect —
	// authenticate() below delegates to the request-time-resolved strategy. It
	// exists so the registered object is an OAuth2Strategy (correct `this`
	// semantics + delegation wiring) from the moment passport can resolve it.
	const wrapper = new OAuth2Strategy(
		{
			authorizationURL: `${nconf.get("url")}/auth/${STRATEGY_NAME}/unconfigured`,
			tokenURL: `${nconf.get("url")}/auth/${STRATEGY_NAME}/unconfigured`,
			clientID: "nodebb-plugin-sso-bgs",
			callbackURL: `${nconf.get("url")}/auth/${STRATEGY_NAME}/callback`,
			passReqToCallback: true,
		},
		() => {}
	);
	wrapper.name = STRATEGY_NAME;

	const base = OAuth2Strategy.prototype.authenticate;
	wrapper.authenticate = function (req, options) {
		resolveStrategy()
			.then((resolved) => {
				if (!resolved) {
					// No (enabled) ACP config: behave like a disabled SSO button.
					winston.warn(
						`[plugin/sso-bgs] /auth/${STRATEGY_NAME} hit but no enabled strategy is configured — check the sso-oauth2-multiple ACP page`
					);
					return this.redirect("/login");
				}
				// Strip core's string ssoState (see buildStrategy's override) so the
				// PKCE session store runs even if the route descriptor didn't set
				// checkState:false.
				const opts = { ...options };
				delete opts.state;
				// Thread passport's per-request delegate (`this`, carrying
				// redirect/success/fail/error/pass) into a target that inherits the
				// resolved strategy's config, and run the PROTOTYPE authenticate on
				// it: `self = this` then finds the delegation methods while
				// `_pkceMethod`/`_oauth2`/the verify callback come from `resolved`.
				const target = Object.create(resolved);
				for (const m of ["redirect", "success", "fail", "error", "pass"]) {
					if (typeof this[m] === "function") {
						target[m] = this[m];
					}
				}
				return base.call(target, req, opts);
			})
			.catch((err) => {
				winston.error(`[plugin/sso-bgs] ${(err && err.stack) || err}`);
				if (typeof this.error === "function") {
					return this.error(err);
				}
				throw err;
			});
	};
	return wrapper;
}

/**
 * The currently-configured PKCE strategy, building/rebuilding it from the db
 * when missing or stale. Concurrent builds are deduped via `building`.
 */
async function resolveStrategy() {
	const config = await getConfig();
	const key = config && config.enabled ? JSON.stringify(config) : null;

	if (key === cachedConfigKey) {
		return cachedStrategy;
	}
	if (!building) {
		building = buildStrategy(config, key).finally(() => {
			building = null;
		});
	}
	return building;
}

// The stock plugin's getStrategy throws a TypeError on a fully-missing db key
// (NodeBB's db.getObjects returns [null] and its getStrategies does
// `strategy.name = ...` on it). Treat that as "not configured" rather than
// erroring every request before the first ACP save.
async function getConfig() {
	try {
		return await stockPlugin().getStrategy(STRATEGY_NAME);
	} catch (err) {
		winston.warn(`[plugin/sso-bgs] could not read strategy config: ${(err && err.message) || err}`);
		return null;
	}
}

async function buildStrategy(config, key) {
	if (!config || !config.enabled) {
		cachedStrategy = null;
		cachedConfigKey = null;
		return null;
	}

	const OAuth = stockPlugin();
	const { OAuth2Strategy } = require("passport-oauth"); // eslint-disable-line global-require
	const inner = new OAuth2Strategy(
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
			// Email-less social signups (#211): the provider omits `email`/`email_verified`.
			// FAIL (not error) with a message — NodeBB core's callback handler redirects a
			// fail's `info.message` to `/?register=<message>`, surfacing it to the user,
			// whereas a done(err) only hits the error page/logs.
			if (!email) {
				return done(null, false, {
					message:
						"This boardgamers account has no email address. " +
						"Add one in your boardgamers.space account settings to log into the forum.",
				});
			}
			if (![id, displayName].every(Boolean)) {
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
				await authenticationController.onSuccessfulLogin(req, user.uid);
				await OAuth.assignGroups({ provider: STRATEGY_NAME, user, profile });
				await OAuth.updateProfile(user.uid, profile);
				done(null, user);

				plugins.hooks.fire("action:oauth2.login", { name: STRATEGY_NAME, user, profile });
			} catch (err) {
				done(err);
			}
		}
	);

	// NodeBB core sets `opts.state = req.session.ssoState` (a STRING) before
	// calling passport.authenticate whenever the route descriptor lacks
	// `checkState: false` — and passport-oauth2, given a string state, skips its
	// PKCE session store entirely (early redirect path), so the `code_verifier`
	// would never be persisted and the callback couldn't redeem the code. Strip
	// `options.state` so the PKCE store always runs (it persists the verifier and
	// mints its own single-use handle as `state`). CSRF is still enforced by
	// PKCESessionStore.verify on the callback (handle match, single-use). The
	// shim's own descriptor already carries `checkState: false`, but the stock
	// plugin's descriptor does NOT — this override makes the strategy correct no
	// matter which descriptor the core route used.
	const base = OAuth2Strategy.prototype.authenticate;
	inner.authenticate = function (req, options) {
		const opts = { ...options };
		delete opts.state;
		return base.call(this, req, opts);
	};

	// Reuse the stock plugin's userinfo fetch + claim normalization.
	inner.userProfile = OAuth.getUserProfile.bind(inner, STRATEGY_NAME, config.userRoute);
	// node-oauth always serializes a `client_secret` key (even with the secret
	// undefined it sends `client_secret=`, which our provider rejects) — replace
	// the exchange so no client_secret is sent at all (public client).
	inner._oauth2.getOAuthAccessToken = publicClientTokenExchange;

	// Cache the built strategy, keyed by its config, so the wrapper's
	// authenticate reuses it until the ACP config changes. We deliberately do
	// NOT passport.use(inner) here: the registered strategy stays the
	// request-time-resolving wrapper (`strategy`), so an ACP edit without a
	// reload still takes effect on the next request (the wrapper rebuilds).
	cachedStrategy = inner;
	cachedConfigKey = key;
	return inner;
}

/**
 * Login-button descriptor, registered at priority 12 so it runs AFTER
 * sso-oauth2-multiple's own loadStrategies (default priority 10) on the shared
 * loginStrategies array: we drop the stock plugin's button descriptor and push
 * our own with `checkState: false` (core then skips its string-ssoState gate,
 * which would otherwise fight the PKCE store — see buildStrategy). Scope and
 * URLs come from the CURRENT db config so they stay right across ACP edits. The
 * underlying strategy resolution happens at request time (resolveStrategy), so
 * this hook no longer needs to have run for logins to work.
 */
Shim.loadStrategies = async (strategies) => {
	const filtered = strategies.filter((s) => s.name !== STRATEGY_NAME);
	const config = await getConfig();
	if (!config || !config.enabled) {
		return filtered;
	}

	// Pre-warm the PKCE strategy cache (the wrapper's authenticate would build
	// it lazily on first request anyway).
	await resolveStrategy();

	filtered.push({
		name: STRATEGY_NAME,
		url: LOGIN_URL,
		callbackURL: CALLBACK_URL,
		icon: config.faIcon || "fa-right-to-bracket",
		icons: {
			normal: `fa ${config.faIcon || "fa-right-to-bracket"}`,
			square: `fa ${config.faIcon || "fa-right-to-bracket"}`,
		},
		labels: {
			login: config.loginLabel || "Log In",
			register: config.registerLabel || "Register",
		},
		color: "#666",
		scope: config.scope || "openid profile email",
		checkState: false,
	});
	return filtered;
};

/**
 * Per-request safety net. NodeBB core fires `filter:auth.options` on EVERY
 * /auth/<name> kickoff, right before `passport.authenticate` — after the route
 * table (and thus the stock plugin's registration) already exists. If the
 * registered strategy for `boardgamers` is not ours (stock plugin overwrote it
 * and no reload has fired our filter:auth.init since — the exact live-forum
 * bug), re-register the request-time-resolving wrapper so this and all
 * subsequent requests resolve the PKCE strategy.
 */
Shim.ensureStrategy = ({ req, res, opts }) => {
	const passport = require("passport"); // eslint-disable-line global-require
	const registered = passport._strategies && passport._strategies[STRATEGY_NAME];
	if (registered !== strategy) {
		passport.use(STRATEGY_NAME, strategy);
	}
	return { req, res, opts };
};

// Register the request-time-resolving strategy as early as possible (module
// load, before any route reload fires filter:auth.init): every later
// passport.use by the stock plugin is pre-warm-only, and the filter:auth.options
// hook re-registers it per request if needed. The filter hooks themselves are
// registered from plugin.json by NodeBB's loader.
require("passport").use(STRATEGY_NAME, strategy); // eslint-disable-line global-require

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
