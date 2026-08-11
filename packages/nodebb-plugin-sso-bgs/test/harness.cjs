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

const nconfValues = { url: "https://forum.boardgamers.space" };
const nconf = {
	get: (key) => nconfValues[key],
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

// Minimal filter-hook registry with NodeBB semantics: default priority 10,
// ascending sort, filter hooks chained through each listener in order.
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
				let result = params;
				for (const entry of hooks.get(hook) || []) {
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
		URLSearchParams,
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
	const env = {
		passport,
		plugins: makePlugins(),
		db,
		loginStrategies: [],
	};
	env.stockOAuth = makeStockPlugin(env);
	env.plugins.hooks.register("nodebb-plugin-sso-oauth2-multiple", {
		hook: "filter:auth.init",
		method: env.stockOAuth.loadStrategies,
	});
	env.shim = loadShim(env, env.stockOAuth);

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

	// core kickoff handler (routes/authentication.js L90-107): applyCSRF →
	// ssoState → filter:auth.options → passport.authenticate(name, opts).
	env.kickoff = async (url) => {
		const descriptor = env.routes.get(url);
		assert.ok(descriptor, `no route for ${url}`);
		const req = {
			session: {},
			query: {},
			connection: { encrypted: true },
			headers: { host: "forum.boardgamers.space" },
			logIn() {},
			isAuthenticated: () => false,
		};
		let opts = { scope: descriptor.scope, prompt: descriptor.prompt || undefined };
		if (descriptor.checkState !== false) {
			req.session.ssoState = "CORE-SSO-STATE-STRING";
			opts.state = req.session.ssoState;
		}
		// core fires filter:auth.options per kickoff request before authenticate
		({ opts } = await env.plugins.hooks.fire("filter:auth.options", { req, res: {}, opts }));
		const { location } = await runAuthenticate(passport, descriptor.name, opts, req);
		return { location, session: req.session, descriptor };
	};

	// core callback handler (routes/authentication.js L110-145): ssoState gate
	// (unless checkState === false), then passport.authenticate(name, cb).
	env.callback = async (session, query) => {
		const descriptor = env.routes.get(`/auth/${query.__name || "boardgamers"}/callback`);
		assert.ok(descriptor, "no callback route");
		const req = {
			session,
			query,
			connection: { encrypted: true },
			headers: { host: "forum.boardgamers.space" },
			logIn() {},
			isAuthenticated: () => false,
		};
		if (descriptor.checkState !== false) {
			assert.strictEqual(
				query.state,
				session.ssoState,
				"core ssoState gate would 403 (checkState descriptor + mismatched state)",
			);
		}
		return new Promise((resolve, reject) => {
			passport.authenticate(descriptor.name, (err, user, info) => {
				if (err) {
					reject(err);
				} else {
					resolve({ user, info });
				}
			})(req, {}, reject);
		});
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
