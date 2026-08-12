"use strict";

const nconf = nodebb.require("nconf");
const winston = nodebb.require("winston");
const plugins = nodebb.require("./src/plugins");
const meta = nodebb.require("./src/meta");
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

// --- Silent (passive) SSO -------------------------------------------------
// Timestamped cookie implementing the silent-login cooldown + explicit-logout
// suppression: while its value is within SILENT_COOLDOWN_MS, anonymous page
// GETs do NOT redirect to the provider (no redirect loop for logged-out
// users, no silent re-login right after an explicit /logout). Its Max-Age is
// deliberately LONGER than the cooldown window so the cookie itself
// outlives the cooldown — the browser only stops sending it well after the
// timestamp already reads as expired.
const SILENT_COOKIE = "bgs_silent";
const SILENT_COOLDOWN_MS = 60 * 60 * 1000; // 1 h
const SILENT_COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day
// Session flag carrying the "this is a silent (prompt=none) round-trip" state
// from the page middleware through the kickoff to the callback.
const SILENT_SESSION_FLAG = "bgsSilent";

function silentCookieOptions() {
	// Same options core uses for its session cookie (Meta.configs.cookie.get):
	// respects cookieDomain / `secure` / relative_path; SameSite=Lax.
	return { ...meta.configs.cookie.get(), maxAge: SILENT_COOKIE_MAX_AGE };
}

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
 * Mount the silent-SSO page middleware. Fires as `static:app.load` (the only
 * hook receiving the real express `app`, at boot and on every plugin/routes
 * reload), inserting the middleware BEFORE NodeBB mounts the page router:
 * every page GET passes through it before any route handler.
 *
 * Mounted on `app` (not `router`) precisely because static:app.load fires
 * BEFORE the page routes exist on `router` — a router.use here would run after
 * the page handlers (which end the response) and never fire.
 *
 * express4 re-mounts a mounted app-level mw on every `app.use(router)` /
 * Router() acquisition, so a re-fire of this hook would stack duplicates; the
 * marker property dedupes (idempotent across reloads).
 */
Shim.appLoad = async ({ app }) => {
	if (app._bgsSilentSso) {
		return;
	}
	app._bgsSilentSso = true;
	app.use(silentLoginPageMiddleware);
};

/**
 * Silent (passive) SSO: a logged-out visitor browsing a normal page with an
 * active boardgamers.space session is auto-logged-in WITHOUT a click, via one
 * OIDC `prompt=none` round-trip.
 *
 * Runs on normal page GETs only, and decides entirely from the request:
 *  - logged in (`req.uid > 0`) or a spider (`req.isSpider()`, @nodebb/spider-detector
 *    mounted by core before the router) → skip;
 *  - not a page request (non-GET method, /api prefix, a path with a file
 *    extension — assets/uploads) → skip;
 *  - already on the SSO login/callback path, /login, /logout, or carrying a
 *    `?logout` marker → skip;
 *  - cooldown cookie fresh (set by a `prompt=none` failure or an explicit
 *    logout) → skip.
 * Otherwise mark the session (`req.session.bgsSilent = true`) and redirect
 * ONCE to `/auth/boardgamers?silent=1` — the regular kickoff route, which
 * re-runs passport with the PKCE strategy; our `filter:auth.options` hook
 * turns that flag into `prompt=none` on the authorize redirect (reusing the
 * exact PKCE/state machinery the manual button uses). A site session returns
 * a code → seamless login; a logged-out provider redirects back with
 * `error=login_required`, which the callback gate (see `ensureStrategy`)
 * turns into the cooldown cookie.
 *
 * `prompt=none` is also what suppresses the provider's consent interstitial
 * (an interstitial mid-round-trip would defeat "silent"), so a user who
 * hasn't consented yet gets `error=consent_required` → same cooldown path.
 */
function silentLoginPageMiddleware(req, res, next) {
	try {
		if (!shouldAttemptSilentLogin(req)) {
			return next();
		}
		req.session = req.session || {};
		req.session[SILENT_SESSION_FLAG] = true;
		res.redirect(`${nconf.get("relative_path") || ""}${LOGIN_URL}?silent=1`);
	} catch (err) {
		// Never break page rendering because of the silent-SSO shim.
		winston.warn(`[plugin/sso-bgs] silent-login middleware: ${(err && err.message) || err}`);
		next();
	}
}

function shouldAttemptSilentLogin(req) {
	// Auth state: req.uid is set by core's setAuthVars (0 = guest, -1 =
	// spider). Fall back to session/passport if core hasn't populated it.
	const uid =
		typeof req.uid === "number" ? req.uid : (req.session && req.session.passport && req.session.passport.user) || 0;
	if (uid > 0 || req.loggedIn) {
		return false;
	}
	// Bots must never be sent through a redirect dance (SEO + they can't log in).
	if (uid === -1 || isSpiderRequest(req)) {
		return false;
	}
	if (String(req.method || "GET").toUpperCase() !== "GET") {
		return false;
	}
	// Path checks run on the mount-relative path (core mounts the page router
	// at relative_path, and our app.use runs before it → req.path is already
	// the in-app path).
	const path = String(req.path || "/");
	if (path === "/api" || path.startsWith("/api/")) {
		return false;
	}
	if (/\.[a-z0-9]{1,8}$/i.test(path)) {
		return false; // static asset / upload / robots.txt / sitemap.xml / ...
	}
	if (path === LOGIN_URL || path === CALLBACK_URL || path === "/login" || path === "/logout") {
		return false;
	}
	const query = req.query || {};
	if ("logout" in query) {
		return false; // explicit logout marker — never silently re-log them in
	}
	if (silentCooldownActive(req)) {
		return false;
	}
	return true;
}

function isSpiderRequest(req) {
	try {
		if (typeof req.isSpider === "function") {
			return !!req.isSpider();
		}
		// Fallback if core's detector.middleware() hasn't populated req.isSpider
		// (same package + UA list core uses, so the behaviour is identical).
		const ua = (req.headers && (req.headers["user-agent"] || req.headers["User-Agent"])) || "";
		// eslint-disable-next-line global-require
		return require("@nodebb/spider-detector").isSpider(ua);
	} catch {
		return false; // fail open for humans rather than skipping silent SSO entirely
	}
}

function silentCooldownActive(req) {
	const cookies = req.cookies || {};
	const raw = cookies[SILENT_COOKIE];
	if (!raw) {
		return false;
	}
	const ts = parseInt(String(raw).replace(/^s:/, ""), 10);
	if (!Number.isFinite(ts) || ts <= 0) {
		return false; // malformed cookie → treat as absent
	}
	return Date.now() - ts < SILENT_COOLDOWN_MS;
}

function armSilentCooldown(res) {
	try {
		res.cookie(SILENT_COOKIE, String(Date.now()), silentCookieOptions());
	} catch (err) {
		winston.warn(`[plugin/sso-bgs] could not set silent-login cooldown cookie: ${(err && err.message) || err}`);
	}
}

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
		() => {},
	);
	wrapper.name = STRATEGY_NAME;

	const base = OAuth2Strategy.prototype.authenticate;
	wrapper.authenticate = function (req, options) {
		resolveStrategy()
			.then((resolved) => {
				if (!resolved) {
					// No (enabled) ACP config: behave like a disabled SSO button.
					winston.warn(
						`[plugin/sso-bgs] /auth/${STRATEGY_NAME} hit but no enabled strategy is configured — check the sso-oauth2-multiple ACP page`,
					);
					return this.redirect("/login");
				}
				// Strip core's string ssoState (see buildStrategy's override) so the
				// PKCE session store runs even if the route descriptor didn't set
				// checkState:false. An OBJECT state (the silent-SSO marker set by
				// withPromptNone) is KEPT so it reaches the PKCE store.
				const opts = { ...options };
				if (typeof opts.state === "string") {
					delete opts.state;
				}
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
				// Run the RESOLVED strategy's OWN authenticate (which carries the
				// string-state strip + the silent-SSO authorizationParams handling) —
				// NOT the bare prototype, or those overrides would be bypassed.
				return resolved.authenticate.call(target, req, opts);
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
		},
	);

	// NodeBB core sets `opts.state = req.session.ssoState` (a STRING) before
	// calling passport.authenticate whenever the route descriptor lacks
	// `checkState: false` — and passport-oauth2, given a string state, skips its
	// PKCE session store entirely (early redirect path), so the `code_verifier`
	// would never be persisted and the callback couldn't redeem the code. Strip
	// a STRING `options.state` so the PKCE store always runs (it persists the
	// verifier and mints its own single-use handle as `state`). CSRF is still
	// enforced by PKCESessionStore.verify on the callback (handle match,
	// single-use). The shim's own descriptor already carries `checkState:
	// false`, but the stock plugin's descriptor does NOT — this override makes
	// the strategy correct no matter which descriptor the core route used.
	//
	// An OBJECT `options.state` is KEPT: it is the silent-SSO round-trip marker
	// (see `withPromptNone`), which the PKCE store persists as `meta.state`.
	const base = OAuth2Strategy.prototype.authenticate;
	inner.authenticate = function (req, options) {
		const opts = { ...options };
		if (typeof opts.state === "string") {
			delete opts.state;
		}
		// Silent SSO: honour a per-request `authorizationParams` (set by
		// withPromptNone). passport-oauth2's stock authorizationParams returns {}
		// and the authorize URL is built ONLY from `this.authorizationParams(opts)`
		// + whitelisted params — so set an own `authorizationParams` on the
		// request's `this` (the wrapper's per-request delegate) to add prompt=none.
		// Then DELETE the opts key (and `opts.prompt`, now consumed) so the
		// prototype doesn't forward them into the URL a second time.
		if (typeof opts.authorizationParams === "function") {
			const reqParams = opts.authorizationParams;
			const baseParams = OAuth2Strategy.prototype.authorizationParams.bind(this);
			this.authorizationParams = (o) => ({ ...baseParams(o), ...reqParams(o) });
			delete opts.authorizationParams;
			delete opts.prompt;
		}
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
 * Per-request safety net AND the silent-SSO kickoff/callback handler. NodeBB
 * core fires `filter:auth.options` on EVERY /auth/<name> kickoff, right before
 * `passport.authenticate` — after the route table (and thus the stock plugin's
 * registration) already exists.
 *
 *  1. Safety net (the original live-forum fix): if the registered strategy for
 *     `boardgamers` is not ours (stock plugin overwrote it and no reload has
 *     fired our filter:auth.init since), re-register the request-time-resolving
 *     wrapper so this and all subsequent requests resolve the PKCE strategy.
 *
 *  2. Silent kickoff: the page middleware redirected here with `?silent=1`
 *     (and set `req.session.bgsSilent`). Add `prompt=none` to the authorize
 *     params (passport-oauth2 passes unknown opts through to the authorize
 *     URL). The `?silent=1` query marker is required — the session flag alone
 *     can survive a manual button click (one retry of an expired session), and
 *     the manual button must NEVER become a silent attempt.
 *
 *  3. Silent callback: `req.session.bgsSilent` is still set on the way back
 *     (same session cookie), so a provider error means the prompt=none attempt
 *     failed (login_required / consent_required / account_selection_required /
 *     interaction_required / ...): arm the cooldown cookie, clear the flag, and
 *     end the response HERE by bouncing to a local page — core's own error
 *     handling never runs, so the user never sees an OIDC error page.
 *     Successes fall through untouched to the normal code exchange.
 */
Shim.ensureStrategy = ({ req, res, opts }) => {
	const passport = require("passport"); // eslint-disable-line global-require
	const registered = passport._strategies && passport._strategies[STRATEGY_NAME];
	if (registered !== strategy) {
		passport.use(STRATEGY_NAME, strategy);
	}

	const path = String((req && req.path) || "");
	if (req && req.session && path === LOGIN_URL) {
		// Kickoff. The silent marker must be BOTH in the session (set by the page
		// middleware) AND in the query (`?silent=1`): the session flag alone can
		// survive a manual button click, and the manual button must NEVER become
		// a silent attempt.
		if (req.session[SILENT_SESSION_FLAG] === true && req.query && "silent" in req.query) {
			opts = withPromptNone(req, opts);
		} else if (req.query && !("silent" in req.query)) {
			// A non-silent (manual) kickoff: consume any stale flag so it can't
			// mark a later callback as silent.
			delete req.session[SILENT_SESSION_FLAG];
		}
	} else if (req && res && path === CALLBACK_URL) {
		// Callback. This attempt was silent iff the PKCE state metadata carries
		// prompt=none (self-describing, no fragile session-flag timing).
		const silent = isSilentCallback(req);
		if (req.session) {
			delete req.session[SILENT_SESSION_FLAG];
		}
		const error = req.query && req.query.error;
		if (silent && error) {
			winston.verbose(`[plugin/sso-bgs] silent SSO: provider returned error=${error}; cooldown armed`);
			armSilentCooldown(res);
			res.redirect(`${nconf.get("relative_path") || ""}/`);
			return { req, res, opts: { ...opts, skip: true } };
		}
	}

	return { req, res, opts };
};

/**
 * Turn a kickoff's passport options into a silent (prompt=none) attempt.
 *
 * passport-oauth2's stock `authorizationParams()` returns `{}` — only
 * whitelisted params (response_type/scope/redirect_uri/code_challenge/state)
 * reach the authorize URL, so a plain `opts.prompt` is DROPPED. We therefore
 * thread prompt=none through the PKCE state store's metadata instead:
 *  - `opts.state` as an OBJECT makes the store persist it as `meta.state` while
 *    minting its own random handle as the actual `state` param (the object
 *    itself never reaches the URL);
 *  - on the callback the store hands that object back as `meta.state`, which
 *    `isSilentCallback` reads to recognise the attempt as silent;
 *  - `opts.authorizationParams` is consulted by the shim's strategy override
 *    (see `buildStrategy`) to actually put `prompt=none` on the authorize URL.
 * Setting an object opts.state is safe here only because our descriptor carries
 * `checkState: false` — core's string-ssoState branch is skipped, so we don't
 * fight it (and the wrapper/strategy strip any string state anyway).
 */
function withPromptNone(req, opts) {
	return {
		...opts,
		prompt: "none", // documents intent; also honoured by any wrapping strategy
		state: { prompt: "none" }, // PKCE-store metadata, read back on the callback
		authorizationParams: (params) => ({ ...params, prompt: "none" }),
	};
}

/**
 * Whether the in-flight callback is the return leg of a silent (prompt=none)
 * attempt: at kickoff, the PKCE store persisted `{handle, code_verifier,
 * state:{prompt:"none"}}` under the strategy's session key. That key is
 * `oauth2:<authorize-url-hostname>` (passport-oauth2 derives it from the
 * configured authorization URL — here the PROVIDER's host, e.g.
 * `oauth2:www.boardgamers.space`, not the forum's). We don't read the config
 * here (this hook is sync), so scan the session for any PKCE entry carrying
 * the prompt=none marker — there is exactly one such entry per attempt.
 */
function isSilentCallback(req) {
	const session = req && req.session;
	if (!session) {
		return false;
	}
	for (const key of Object.keys(session)) {
		if (!key.startsWith("oauth2:")) {
			continue;
		}
		const meta = session[key] && session[key].state;
		if (meta && meta.state && meta.state.prompt === "none") {
			return true;
		}
	}
	return false;
}

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
