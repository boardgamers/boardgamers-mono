"use strict";

/**
 * Faithful NodeBB v4.14.0 simulation harness for nodebb-plugin-sso-bgs.
 *
 * What is REAL here (same code as the live forum):
 *  - `passport` 0.7.0 (Authenticator, last-write-wins `use`)
 *  - `passport-oauth` 1.0.0 → `passport-oauth2` 1.8.0 (PKCE, state stores,
 *    the string-`options.state` early-redirect path that skips the PKCE store)
 *  - the stock `nodebb-plugin-sso-oauth2-multiple` `loadStrategies` wiring,
 *    transcribed verbatim (non-PKCE strategy, descriptor WITHOUT checkState)
 *  - NodeBB core `src/routes/authentication.js` reloadRoutes: shared
 *    loginStrategies array, `filter:auth.init` fired ONCE per route reload,
 *    hook priority order (10 stock → 12 shim), string `opts.state` set from
 *    `req.session.ssoState` unless the descriptor has `checkState === false`,
 *    and the callback's ssoState equality gate.
 *  - `@nodebb/spider-detector` 2.0.3 (the exact package + version core mounts
 *    in webserver.js) — run for every harness request so `req.isSpider()` is
 *    faithful, and injected for the shim's own UA-detection fallback.
 *  - the app-level page middleware the shim mounts from `static:app.load`
 *    (silent SSO): env.appLoad() runs the hook against a mock express `app`,
 *    and env.page(path, opts) drives a request through the mounted stack.
 *  - the shim under test: `library.js`, loaded via a NodeBB-style sandbox
 *    (`nodebb.require` global, like NodeBB's own loader).
 *
 * The kickoff assert drives the REAL passport middleware chain
 * (`passport.authenticate(name, opts)(req, res, next)`) and captures the 302
 * Location — exactly what the live forum sends the browser.
 */

const { createRequire } = require("module");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const depsRequire = createRequire("/tmp/sso-bgs-deps/node_modules/");

// ---------------------------------------------------------------------------
// In-memory stand-ins for the NodeBB environment the plugins touch
// ---------------------------------------------------------------------------

const dbObjects = new Map(); // `oauth2-multiple:strategies:<name>` → config object
const dbSortedSets = new Map(); // `oauth2-multiple:strategies` → [name, ...]

const db = {
	async getSortedSetMembers(key) {
		return [...(dbSortedSets.get(key) || [])];
	},
	async getObjects(keys) {
		// Real NodeBB db.getObjects returns null for a missing key (mongo/redis
		// hash.js) — mirror that so the stock plugin's `strategy.name = ...` on a
		// missing key throws, exactly as on the live forum before configuration.
		return keys.map((key) => (dbObjects.has(key) ? { ...dbObjects.get(key) } : null));
	},
	async sortedSetAdd(key, _score, member) {
		const set = dbSortedSets.get(key) || [];
		if (!set.includes(member)) {
			set.push(member);
		}
		dbSortedSets.set(key, set);
	},
	async setObject(key, payload) {
		dbObjects.set(key, { ...payload });
	},
};

const nconfValues = { url: "https://forum.boardgamers.space", relative_path: "" };
const nconf = {
	get: (key) => nconfValues[key],
};

// src/meta — only `Meta.configs.cookie.get()` is used (by the silent-login
// cooldown cookie). Verbatim semantics of core's Configs.cookie.get().
const meta = {
	configs: {
		cookie: {
			get: () => {
				const cookie = {};
				if (nconf.get("cookieDomain")) {
					cookie.domain = nconf.get("cookieDomain");
				}
				if (nconf.get("secure")) {
					cookie.secure = true;
				}
				if (nconf.get("relative_path")) {
					cookie.path = nconf.get("relative_path");
				}
				cookie.sameSite = "Lax";
				return cookie;
			},
		},
	},
};

const logs = [];
const winston = {
	verbose: (msg) => logs.push(["verbose", msg]),
	info: (msg) => logs.push(["info", msg]),
	warn: (msg) => logs.push(["warn", msg]),
	error: (msg) => logs.push(["error", msg]),
};

const authenticationController = {
	async onSuccessfulLogin() {},
};

// Minimal hook registry with NodeBB semantics: default priority 10, ascending
// sort. FILTER hooks are chained through each listener in order; STATIC hooks
// (e.g. static:app.load) are fired in parallel for side effects and their
// return value is ignored (NodeBB fires them via Promise.all, not chained).
function makePlugins() {
	const hooks = new Map();
	return {
		hooks: {
			register(id, data) {
				const entry = { id, priority: data.priority || 10, method: data.method };
				hooks.set(data.hook, [...(hooks.get(data.hook) || []), entry]);
				hooks.get(data.hook).sort((a, b) => a.priority - b.priority);
			},
			async fire(hook, params) {
				const entries = hooks.get(hook) || [];
				if (hook.startsWith("static:")) {
					await Promise.all(entries.map((entry) => entry.method(params)));
					return params;
				}
				let result = params;
				for (const entry of entries) {
					result = await entry.method(result);
				}
				return result;
			},
			listeners: (hook) => hooks.get(hook) || [],
		},
	};
}

// ---------------------------------------------------------------------------
// Stock plugin: loadStrategies transcribed verbatim from
// nodebb-plugin-sso-oauth2-multiple@2.x library.js (only `OAuth.login` and
// the bits the shim never calls are stubbed).
// ---------------------------------------------------------------------------

function makeStockPlugin(env) {
	const { passport } = env;
	const OAuth = {
		async getStrategy(name) {
			// Verbatim from the stock plugin: a missing key makes `strategy.name =`
			// throw a TypeError (the shim now guards against this).
			const strategies = await env.db.getObjects([`oauth2-multiple:strategies:${name}`]);
			strategies.forEach((strategy) => {
				strategy.name = name;
				strategy.enabled = strategy.enabled === "true" || strategy.enabled === true;
				strategy.callbackUrl = `${nconf.get("url")}/auth/${name}/callback`;
			});
			return strategies.length ? strategies[0] : null;
		},
		async listStrategies() {
			const names = await env.db.getSortedSetMembers("oauth2-multiple:strategies");
			const out = [];
			for (const name of names.sort()) {
				const strategy = await OAuth.getStrategy(name);
				if (strategy) {
					out.push(strategy);
				}
			}
			return out;
		},
		async login({ handle }) {
			return { uid: 1, username: handle };
		},
		async assignGroups() {},
		async updateProfile() {},
		getUserProfile(name, userRoute, accessToken, done) {
			// The harness never reaches userinfo; shim overrides this anyway.
			done(new Error("getUserProfile: not implemented in harness"));
		},
	};

	OAuth.loadStrategies = async (strategies) => {
		const passportOAuth = depsRequire("passport-oauth").OAuth2Strategy;

		let configured = await OAuth.listStrategies(true);
		configured = configured.filter((obj) => obj.enabled);

		const configs = configured.map(
			({
				name,
				authUrl: authorizationURL,
				tokenUrl: tokenURL,
				id: clientID,
				secret: clientSecret,
				callbackUrl: callbackURL,
			}) =>
				new passportOAuth(
					{ authorizationURL, tokenURL, clientID, clientSecret, callbackURL, passReqToCallback: true },
					async (req, token, secret, profile, done) => done(null, { uid: 1 }),
				),
		);

		configs.forEach((strategy, idx) => {
			strategy.userProfile = OAuth.getUserProfile.bind(strategy, configured[idx].name, configured[idx].userRoute);
			passport.use(configured[idx].name, strategy);
		});

		strategies.push(
			...configured.map(({ name, scope, loginLabel, registerLabel, faIcon }) => ({
				name,
				url: `/auth/${name}`,
				callbackURL: `/auth/${name}/callback`,
				icon: faIcon || "fa-right-to-bracket",
				labels: { login: loginLabel || "Log In", register: registerLabel || "Register" },
				scope: scope || "openid email profile",
			})),
		);

		return strategies;
	};

	return OAuth;
}

// ---------------------------------------------------------------------------
// Shim loading: library.js in a NodeBB-style sandbox (global `nodebb`).
// ---------------------------------------------------------------------------

function loadShim(env, stockOAuth) {
	const plugins = env.plugins;
	const shimPath = path.join(__dirname, "..", "library.js");
	const code = require("fs").readFileSync(shimPath, "utf8");

	const shimRequire = (spec) => {
		if (spec === "nodebb-plugin-sso-oauth2-multiple/library.js") {
			return stockOAuth;
		}
		if (spec === "passport-oauth") {
			return depsRequire("passport-oauth");
		}
		if (spec === "passport") {
			return env.passport;
		}
		if (spec === "@nodebb/spider-detector") {
			// Same package+version NodeBB 4.14 core mounts (webserver.js) — the
			// shim's UA-detection fallback behaves exactly like core's.
			return depsRequire("@nodebb/spider-detector");
		}
		return createRequire(shimPath)(spec);
	};

	const nodebbGlobal = {
		require(spec) {
			if (spec === "nconf") {
				return nconf;
			}
			if (spec === "winston") {
				return winston;
			}
			if (spec === "./src/plugins") {
				return plugins;
			}
			if (spec === "./src/meta") {
				return meta;
			}
			if (spec === "./src/controllers/authentication") {
				return authenticationController;
			}
			if (spec === "./src/database") {
				return db;
			}
			throw new Error(`nodebb.require(${spec}) not mocked`);
		},
	};

	const module = { exports: {} };
	const sandbox = {
		nodebb: nodebbGlobal,
		require: shimRequire,
		module,
		exports: module.exports,
		__dirname: path.dirname(shimPath),
		URL,
		URLSearchParams,
		Date,
		fetch,
		console,
	};
	// Share the SAME stock-plugin object with the sandbox so tests that stub
	// env.stockOAuth.getUserProfile affect the object the shim uses.
	sandbox.__stockOAuth = stockOAuth;
	// Stubbable network edge for the token exchange: tests set env.fetchImpl.
	sandbox.fetch = (...args) => {
		if (!env.fetchImpl) {
			throw new Error("fetch called but env.fetchImpl is not set");
		}
		return env.fetchImpl(...args);
	};

	vm.createContext(sandbox);
	vm.runInContext(code, sandbox, { filename: shimPath });

	// NodeBB's loader registers the plugin.json hooks against the library.
	// (The shim also passport.use's its wrapper strategy at module load — that
	// part of the fix runs inside the sandbox above.)
	for (const hook of require(path.join(__dirname, "..", "plugin.json")).hooks) {
		const method = module.exports[hook.method];
		assert.strictEqual(typeof method, "function", `shim exports ${hook.method}`);
		env.plugins.hooks.register("nodebb-plugin-sso-bgs", { ...hook, method });
	}
	return module.exports;
}

// ---------------------------------------------------------------------------
// NodeBB core: routes/authentication.js reloadRoutes (verbatim semantics) +
// a request driver for the kickoff route.
// ---------------------------------------------------------------------------

function makeEnv() {
	const passport = depsRequire("passport");
	// Stand-in for the express app passed to `static:app.load`: the shim mounts
	// the silent-login page middleware on it via app.use.
	const app = {
		middleware: [],
		use(fn) {
			this.middleware.push(fn);
		},
	};
	const env = {
		passport,
		plugins: makePlugins(),
		db,
		loginStrategies: [],
		app,
	};
	env.stockOAuth = makeStockPlugin(env);
	env.plugins.hooks.register("nodebb-plugin-sso-oauth2-multiple", {
		hook: "filter:auth.init",
		method: env.stockOAuth.loadStrategies,
	});
	env.shim = loadShim(env, env.stockOAuth);

	// Core fires static:app.load (with {app, router, ...}) at boot/reload; the
	// shim's appLoad hook mounts silentLoginPageMiddleware on the app and its
	// init hook serves the CIMD doc on the router.
	env.appLoad = async () => {
		const router = { get() {}, use() {} };
		await env.plugins.hooks.fire("static:app.load", { app, router });
	};

	// core reloadRoutes: clears the array, fires filter:auth.init once,
	// registers routes per descriptor.
	env.reloadRoutes = async () => {
		env.loginStrategies.length = 0;
		env.loginStrategies = (await env.plugins.hooks.fire("filter:auth.init", env.loginStrategies)) || [];
		env.routes = new Map();
		for (const strategy of env.loginStrategies) {
			env.routes.set(strategy.url, strategy);
			env.routes.set(strategy.callbackURL, strategy);
		}
		return env.loginStrategies;
	};

	// Minimal express-like request/response factories. `opts`:
	//   path, method, query, session, cookies, loggedIn, spider, ua, cookieJar
	function makeReq(opts = {}) {
		const jar = opts.cookieJar || opts.cookies || {};
		const session = opts.session || {};
		const req = {
			path: opts.path || "/",
			method: opts.method || "GET",
			query: opts.query || {},
			session,
			cookies: { ...jar },
			connection: { encrypted: true },
			headers: {
				host: "forum.boardgamers.space",
				"user-agent": opts.ua || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
			},
			get(name) {
				return this.headers[String(name).toLowerCase()];
			},
			logIn() {},
			isAuthenticated: () => false,
		};
		// Core's setAuthVars (routes/authentication.js): loggedIn/uid from the
		// spider check + session user.
		req.uid = opts.loggedIn ? 1 : opts.spider ? -1 : 0;
		req.loggedIn = req.uid > 0;
		// Core mounts @nodebb/spider-detector's middleware before the router —
		// run the REAL one here so req.isSpider is exactly what core provides.
		depsRequire("@nodebb/spider-detector").middleware()(req, {}, () => {});
		if (opts.spider && typeof req.isSpider !== "function") {
			req.isSpider = () => true;
		}
		return req;
	}

	function makeRes(jar) {
		const headers = {};
		const res = {
			headers,
			setCookies: [],
			statusCode: 200,
			body: undefined,
			setHeader(key, value) {
				headers[key.toLowerCase()] = value;
			},
			// express res.cookie: record + reflect into the shared cookie jar so
			// subsequent requests "send" it.
			cookie(name, value, options) {
				res.setCookies.push({ name, value, options });
				jar[name] = value;
			},
			clearCookie(name) {
				delete jar[name];
			},
			redirect(url) {
				res.statusCode = 302;
				res.headers.location = url;
				res.body = url;
				return res;
			},
			status(code) {
				res.statusCode = code;
				return res;
			},
			send(b) {
				res.body = b;
				return res;
			},
			end() {},
		};
		return res;
	}

	// A normal page GET through the shim's app-level middleware (the one
	// static:app.load mounts). Returns { statusCode, location, session, cookies,
	// proceeded } — `proceeded` is true when the middleware called next()
	// (i.e. did NOT redirect). Core's own page handling is not simulated.
	env.page = async (path, opts = {}) => {
		const jar = opts.cookieJar || {};
		const req = makeReq({ ...opts, path });
		const res = makeRes(jar);
		const stack = env.app.middleware;
		assert.ok(stack.length > 0, "env.appLoad() was not run — no app middleware mounted");
		let idx = 0;
		let proceeded = false;
		const run = () => {
			if (res.headers.location || res.statusCode === 302) {
				return;
			}
			if (idx >= stack.length) {
				proceeded = true;
				return;
			}
			const fn = stack[idx++];
			fn(req, res, (err) => {
				assert.ifError(err);
				run();
			});
		};
		run();
		return {
			statusCode: res.statusCode,
			location: res.headers.location || null,
			session: req.session,
			cookies: jar,
			setCookies: res.setCookies,
			proceeded,
		};
	};

	// core kickoff handler (routes/authentication.js L90-107): applyCSRF →
	// ssoState → filter:auth.options → passport.authenticate(name, opts).
	env.kickoff = async (url, opts = {}) => {
		const parsed = new URL(url, "https://forum.boardgamers.space");
		const descriptor = env.routes.get(parsed.pathname);
		assert.ok(descriptor, `no route for ${parsed.pathname}`);
		const jar = opts.cookieJar || {};
		const req = makeReq({
			path: parsed.pathname,
			query: { ...Object.fromEntries(parsed.searchParams), ...(opts.query || {}) },
			session: opts.session || {},
			cookieJar: jar,
			loggedIn: opts.loggedIn,
			ua: opts.ua,
		});
		const res = makeRes(jar);
		let authOpts = { scope: descriptor.scope, prompt: descriptor.prompt || undefined };
		if (descriptor.checkState !== false) {
			req.session.ssoState = "CORE-SSO-STATE-STRING";
			authOpts.state = req.session.ssoState;
		}
		// core fires filter:auth.options per kickoff request before authenticate
		({ opts: authOpts } = await env.plugins.hooks.fire("filter:auth.options", { req, res, opts: authOpts }));
		if (res.headers.location) {
			// A hook (the shim's silent-callback gate) ended the response with a
			// redirect — core's passport.authenticate never runs.
			return {
				location: res.headers.location,
				session: req.session,
				descriptor,
				setCookies: res.setCookies,
				opts: authOpts,
				skipped: true,
			};
		}
		const { location } = await runAuthenticate(passport, descriptor.name, authOpts, req);
		return { location, session: req.session, descriptor, setCookies: res.setCookies, opts: authOpts };
	};

	// core callback handler (routes/authentication.js L110-145): ssoState gate
	// (unless checkState === false), filter:auth.options (the shim's
	// silent-callback gate), then passport.authenticate(name, cb).
	env.callback = async (session, query, opts = {}) => {
		const name = query.__name || "boardgamers";
		const descriptor = env.routes.get(`/auth/${name}/callback`);
		assert.ok(descriptor, "no callback route");
		const jar = opts.cookieJar || {};
		const req = makeReq({
			path: `/auth/${name}/callback`,
			query,
			session,
			cookieJar: jar,
			loggedIn: opts.loggedIn,
			ua: opts.ua,
		});
		const res = makeRes(jar);
		if (descriptor.checkState !== false) {
			assert.strictEqual(
				query.state,
				session.ssoState,
				"core ssoState gate would 403 (checkState descriptor + mismatched state)",
			);
		}
		// fire filter:auth.options (the shim's silent-callback gate lives there)
		let authOpts = { scope: descriptor.scope };
		({ opts: authOpts } = await env.plugins.hooks.fire("filter:auth.options", { req, res, opts: authOpts }));
		if (res.headers.location) {
			// The silent-callback gate armed the cooldown and bounced — core's
			// own error handling / passport.authenticate never run.
			return {
				redirected: res.headers.location,
				session: req.session,
				cookies: jar,
				setCookies: res.setCookies,
				gated: true,
			};
		}
		const result = await new Promise((resolve, reject) => {
			passport.authenticate(descriptor.name, (err, user, info) => {
				if (err) {
					reject(err);
				} else {
					resolve({ user, info });
				}
			})(req, res, reject);
		});
		return { ...result, session: req.session, cookies: jar, setCookies: res.setCookies };
	};

	return env;
}

function runAuthenticate(passport, name, opts, req) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const done = (fn, value) => {
			if (!settled) {
				settled = true;
				fn(value);
			}
		};
		const headers = {};
		const res = {
			setHeader(key, value) {
				headers[key.toLowerCase()] = value;
			},
			// passport's authenticate middleware redirects the way express's
			// res.redirect does internally: setHeader('Location') + end().
			end() {
				done(() => resolve({ location: headers.location || null }));
			},
			redirect: (url) => done((v) => resolve({ location: v }), url),
		};
		passport.authenticate(name, opts)(req, res, (err) => done(() => (err ? reject(err) : resolve({ location: null }))));
	});
}

// ACP save (stock plugin's editStrategy controller): writes the db, nothing else.
async function acpSaveStrategy(config) {
	await db.sortedSetAdd("oauth2-multiple:strategies", Date.now(), "boardgamers");
	await db.setObject("oauth2-multiple:strategies:boardgamers", config);
}

const VALID_CONFIG = {
	enabled: true,
	authUrl: "https://www.boardgamers.space/api/oauth2/authorize",
	tokenUrl: "https://www.boardgamers.space/api/oauth2/token",
	userRoute: "https://www.boardgamers.space/api/oauth2/userinfo",
	id: "https://forum.boardgamers.space/client-metadata.json",
	secret: "__UNUSED__",
	scope: "openid profile email role",
};

function authorizeParams(location) {
	assert.ok(location, "expected a redirect Location");
	return new URL(location).searchParams;
}

module.exports = { makeEnv, acpSaveStrategy, VALID_CONFIG, authorizeParams, db, dbObjects, dbSortedSets };
