import assert from "node:assert";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
// @ts-ignore - passport types
import type { Strategy } from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
// GitHub and Hugging Face both run on the generic OAuth2 strategy: GitHub implements
// plain OAuth2 (its userinfo is https://api.github.com/user), and no maintained
// passport-huggingface package exists (HF implements plain OAuth2/OIDC). Crucially,
// passport-github2 has no PKCE support while passport-oauth2 >= 1.7 does — both
// providers are configured as PKCE public clients below.
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { z } from "zod";
import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "./db.ts";
import { createOAuthState, takePendingSignup, verifyOAuthState } from "../models/oauthflows.ts";

// Burn a pending-signup ticket (single-use, Mongo — models/oauthflows.ts) into the
// payload the social-signup strategy consumes.
async function resolvePendingSignup(ticket: string) {
	const pending = await takePendingSignup(ticket);
	if (!pending) {
		throw createError(401, "Invalid or expired signup ticket");
	}
	return { provider: pending.provider, socialId: pending.socialId, socialMeta: pending.socialMeta };
}
import {
	findByEmail,
	findByUsername,
	generateConfirmKey,
	generateHash,
	hashUserSecret,
	makeDefaultUser,
	sendConfirmationEmail,
	validPassword,
	validateResetKey,
	resetPassword,
} from "../models/user.ts";
import env from "./env.ts";

// =========================================================================
// LOCAL SIGNUP ============================================================
// =========================================================================
// we are using named strategies since we have one for login and one for signup
// by default, if there was no name, it would just be called 'local'

passport.use(
	"local-signup",
	new LocalStrategy(
		{
			// by default, local strategy uses username and password, we will override with email
			usernameField: "email",
			passwordField: "password",
			passReqToCallback: true, // allows us to pass back the entire request to the callback
		},
		async (req, email, password, done) => {
			try {
				// find a user whose email is the same as the forms email
				// we are checking to see if the user trying to login already exists
				if (!z.string().email().safeParse(email).success) {
					throw createError(422, "Wrong email format");
				}

				if (password.length < Number(env.minPasswordLength)) {
					throw createError(422, "Password is too short");
				}

				if (!req.body.termsAndConditions) {
					throw createError(422, "You need to read and agree to the terms and conditions");
				}

				// check to see if there's already a user with that email
				if (await findByEmail(email)) {
					throw createError(409, "Email is already taken");
				}

				const { username } = req.body;

				if (!username) {
					throw createError(422, "Specify a username");
				}

				if (username.includes("@")) {
					throw createError(422, "Username can't contain @");
				}

				if (await findByUsername(username)) {
					throw createError(422, `Username ${username} is taken`);
				}

				// if there is no user with that email
				// create the user
				const slug = username.toLowerCase().replace(/\s+/g, "-");
				const confirmKey = generateConfirmKey();
				const newUserDoc: UserDoc = makeDefaultUser({
					username,
					email: email.toLowerCase().trim(),
					slug,
					password: await generateHash(password),
					// Only the hash is stored (#164); the plaintext lives in the emailed link.
					confirmKey: hashUserSecret(confirmKey),
					confirmed: false,
					newsletter: req.body.newsletter === true || req.body.newsletter === "true",
				});

				const result = await colls.users.insertOne(newUserDoc);
				const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };
				// The confirmation email embeds the plaintext key — swap it back into the
				// in-memory doc (sendConfirmationEmail reads security.confirmKey).
				newUser.security.confirmKey = confirmKey;

				if (!newUser.security.confirmed) {
					await sendConfirmationEmail(newUser);
				}

				return done(null, newUser);
			} catch (err) {
				return done(err);
			}
		},
	),
);

passport.use(
	"social-signup",
	new LocalStrategy(
		{
			usernameField: "username",
			// Just needed by passport :/
			passwordField: "username",
			passReqToCallback: true, // allows us to pass back the entire request to the callback
		},
		async (req, username, password, done) => {
			try {
				const { jwt: token, ticket } = z
					.object({ jwt: z.string().optional(), ticket: z.string().optional() })
					.parse(req.body);

				if (!req.body.termsAndConditions) {
					throw createError(422, "You need to read and agree to the terms and conditions");
				}

				if (!username) {
					throw createError(422, "Specify a username");
				}

				if (username.includes("@")) {
					throw createError(422, "Username can't contain @");
				}

				if (await findByUsername(username)) {
					throw createError(422, `Username ${username} is taken`);
				}

				// New-style flows carry a single-use server-side ticket instead of a JWT.
				assert(ticket || token, "Missing signup ticket");
				const decoded = ticket
					? await resolvePendingSignup(ticket)
					: z
							.object({
								provider: z.enum(["google", "facebook", "discord", "github", "huggingface"]),
								id: z.string(),
								createSocialAccount: z.literal(true),
								socialMeta: z.object({ username: z.string(), url: z.string() }).optional(),
							})
							.transform(({ id, ...rest }) => ({ ...rest, socialId: id }))
							.parse(jwt.verify(String(token), env.jwt.keys.public));

				// create the user
				const slug = username.toLowerCase().replace(/\s+/g, "-");
				const social = { [decoded.provider]: decoded.socialId };
				const socialMeta = decoded.socialMeta ? { [decoded.provider]: decoded.socialMeta } : undefined;
				const newUserDoc: UserDoc = makeDefaultUser({
					username,
					email: "",
					slug,
					password: "",
					confirmKey: "",
					confirmed: true,
					newsletter: false,
					social,
					socialMeta,
				});

				const result = await colls.users.insertOne(newUserDoc);
				const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };

				// sendAuthInfo picks the provider up to stamp it on the refresh token.
				return done(null, { ...newUser, loginMethod: decoded.provider });
			} catch (err) {
				return done(err);
			}
		},
	),
);

passport.use(
	"local-reset",
	new LocalStrategy(
		{
			// by default, local strategy uses username and password, we will override with email
			usernameField: "email",
			passwordField: "password",
			passReqToCallback: true, // allows us to pass back the entire request to the callback
		},
		async (req, email, password, done) => {
			try {
				// find a user whose email is the same as the forms email
				// we are checking to see if the user trying to login already exists

				if (password.length < Number(env.minPasswordLength)) {
					throw createError(422, "Password too short");
				}

				const user = await findByEmail(email);

				// check to see if theres already a user with that email
				if (!user) {
					throw createError(404, "No user with this email");
				}

				validateResetKey(user, req.body.resetKey);

				// set the user's local credentials
				await resetPassword(user, password);

				return done(null, user);
			} catch (err) {
				return done(err);
			}
		},
	),
);

// =========================================================================
// LOCAL LOGIN =============================================================
// =========================================================================
// we are using named strategies since we have one for login and one for signup
// by default, if there was no name, it would just be called 'local'

passport.use(
	"local-login",
	new LocalStrategy(
		{
			// by default, local strategy uses username and password, we will override with email
			usernameField: "email",
			passwordField: "password",
		},
		async (email, password, done) => {
			try {
				const user = (await findByEmail(email)) ?? (await findByUsername(email));
				// if no user is found, return the message
				if (!user) {
					throw createError(404, `${email} isn't registered`);
				}

				// if the user is found but the password is wrong
				if (!(await validPassword(user, password))) {
					throw createError(401, "Oops! Wrong password");
				}
				done(null, user);
			} catch (err) {
				done(err);
			}
		},
	),
);

// The social providers (Hugging Face no longer lives in env.social — it uses CIMD, no
// env/registration at all; see the huggingface block below).
type SocialProvider = "discord" | "google" | "facebook" | "github" | "huggingface";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SocialStrategyCtor<T extends Strategy> = new (options: any, verify: any) => T;

// Passport profile shape is a superset; we only ever read these fields. `username` /
// `profileUrl` are optional because not every provider supplies them (HF supplies neither,
// so its strategy fills them in from the userinfo payload — see its userProfile override).
type SocialProfile = {
	id: string;
	username?: string;
	profileUrl?: string;
};

// Extra strategy constructor options for GitHub (on the generic OAuth2 strategy, which
// requires its endpoints at construction). Hugging Face is configured separately in its
// own per-origin CIMD factory below.
const extraStrategyOptions: Partial<Record<SocialProvider, Record<string, unknown>>> = {
	github: {
		authorizationURL: "https://github.com/login/oauth/authorize",
		tokenURL: "https://github.com/login/oauth/access_token",
		// PKCE public client (passport-oauth2 >= 1.7): S256 code challenge, no client
		// secret needed. `state: true` is required by passport-oauth2 when pkce is on
		// (it stores the code verifier against a CSRF state handle).
		pkce: true,
		state: true,
		scope: ["read:user"],
		// passport-github2's default is `skipUserProfile: false` + an email fallback
		// request; keep parity: profile comes straight from https://api.github.com/user
		// (the userProfile override below), no extra /user/emails call.
		skipUserProfile: false,
	},
};

// Providers using a PKCE public client may omit the client secret entirely.
// (Hugging Face is CIMD — always a public PKCE client, never a secret — and is built
// in its own factory, so it isn't listed here.)
const secretOptional: Partial<Record<SocialProvider, true>> = {
	github: true,
};

// Default public profile URL per provider, for providers whose passport profile lacks
// profileUrl (discord) or username (facebook with the default fields).
const defaultProfileUrl: Partial<Record<SocialProvider, (profile: SocialProfile) => string>> = {
	discord: (profile) => `https://discord.com/users/${profile.id}`,
	huggingface: (profile) => `https://huggingface.co/${profile.username ?? profile.id}`,
};

// Extract ONLY non-sensitive display fields (public username + profile URL) from the
// OAuth profile. Never persist tokens or the raw provider payload (profile._json).
function socialMetaOf(provider: SocialProvider, profile: SocialProfile) {
	const username = profile.username ?? profile.profileUrl?.replace(/\/+$/, "").split("/").pop() ?? profile.id;
	const url = profile.profileUrl ?? defaultProfileUrl[provider]?.(profile);
	return url ? { username, url } : undefined;
}

function makeSocialStrategy<T extends Strategy>(
	provider: Exclude<SocialProvider, "huggingface">,
	SocialStrategy: SocialStrategyCtor<T>,
) {
	const { id, secret } = env.social[provider];
	assert(
		secret || secretOptional[provider],
		`${provider} OAuth secret is required (or the provider must opt into PKCE)`,
	);
	passport.use(
		provider,
		new SocialStrategy(
			{
				clientID: id,
				// PKCE public clients (github) pass no secret; confidential clients require one.
				clientSecret: secret,
				passReqToCallback: true,
				// The api serves the callback at /api/account/auth/<provider>/callback
				// (router mounted /api/account → /auth). nginx routes only /api/* to the api;
				// a bare /auth/... hits the web SPA and 404s.
				callbackURL: `https://${env.site}/api/account/auth/${provider}/callback`,
				...extraStrategyOptions[provider],
			},
			function (
				req: { user?: WithId<UserDoc> },
				_token: string,
				_tokenSecret: string,
				profile: SocialProfile,
				done: (err: unknown, user?: unknown) => void,
			) {
				verifySocialProfile(provider, req, profile).then((user) => done(null, user), done);
			},
		),
	);
}

// Link-or-create logic shared by every social strategy (makeSocialStrategy's verify
// callback and Hugging Face's per-origin CIMD strategy). Resolves the OAuth profile to
// an existing user, links to the logged-in user, or yields a createSocialAccount
// feedback object for the signup flow.
async function verifySocialProfile(
	provider: SocialProvider,
	req: { user?: WithId<UserDoc> },
	profile: SocialProfile,
): Promise<unknown> {
	const socialMeta = socialMetaOf(provider, profile);
	const currentUser = req.user;
	const existingUser = await colls.users.findOne({ [`account.social.${provider}`]: profile.id });

	if (currentUser) {
		if (existingUser && existingUser._id.equals(currentUser._id)) {
			return existingUser;
		}
		assert(!currentUser.account.social?.[provider], `You already have a ${provider} account connected`);
		assert(!existingUser, `Another user is already connected to that ${provider} account`);

		await colls.users.updateOne(
			{ _id: currentUser._id },
			{
				$set: {
					[`account.social.${provider}`]: profile.id,
					...(socialMeta ? { [`account.socialMeta.${provider}`]: socialMeta } : {}),
				},
			},
		);
		return colls.users.findOne({ _id: currentUser._id });
	}

	if (existingUser) {
		// Backfill display meta for accounts linked before socialMeta existed.
		if (socialMeta && !existingUser.account.socialMeta?.[provider]) {
			await colls.users.updateOne(
				{ _id: existingUser._id },
				{ $set: { [`account.socialMeta.${provider}`]: socialMeta } },
			);
		}
		return existingUser;
	}

	// Create a new account (omit socialMeta when absent: it rides in a JWT and the
	// signup body schema, where an explicit undefined would needlessly differ).
	return {
		createSocialAccount: true,
		provider,
		id: profile.id,
		...(socialMeta ? { socialMeta } : {}),
	};
}

makeSocialStrategy("discord", DiscordStrategy);
makeSocialStrategy("google", GoogleStrategy);
makeSocialStrategy("facebook", FacebookStrategy);
makeSocialStrategy("github", OAuth2Strategy);
// Hugging Face is NOT registered here: it uses CIMD with a per-origin client_id (the
// env's own /.well-known/oauth-cimd URL), so strategies are built lazily per origin —
// see huggingfaceStrategy() below.

type OAuth2StrategyInstance = InstanceType<typeof OAuth2Strategy>;
type OAuth2Internals = {
	_oauth2: { useAuthorizationHeaderforGET(v: boolean): void };
	userProfile: (accessToken: string, done: (err?: unknown, profile?: unknown) => void) => void;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose _strategy
const strategyOf = (name: SocialProvider) =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
	(passport as unknown as { _strategy(n: string): unknown })._strategy(name) as OAuth2StrategyInstance &
		OAuth2Internals;

// The default PKCE state store keeps the code verifier in `req.session`, which this app
// doesn't have. This store keeps the same CSRF model (random handle in the OAuth `state`
// param, verified on callback) but persists server-side in Mongo (models/oauthflows.ts).
// Why not an httpOnly cookie instead? The verifier is a bearer secret: server-side it
// never enters the browser at all, while a cookie travels with every request; deletion
// on first callback makes it genuinely single-use server-side (a cookie clears only when
// the response reaches the browser); and it survives restarts / works across PM2 workers
// with no sticky routing. The collection also backs the pending-signup ticket, which is
// redeemed on the web origin after the callback — that one can't be a cookie regardless.
// Shared by every PKCE strategy.
const STATE_TTL_MS = 15 * 60 * 1000;

const mongoStateStore = {
	store(req: unknown, verifier: string, _state: unknown, _meta: unknown, cb: (err: unknown, handle?: string) => void) {
		createOAuthState({
			codeVerifier: verifier,
			expiresAt: new Date(Date.now() + STATE_TTL_MS),
		}).then((handle) => cb(null, handle), cb);
	},
	// passport-oauth2 branches on arity: 4 params → meta variant, which treats the 3rd
	// callback arg as the info object passed to fail() — not our state payload. Declare 3.
	// Single-use: an unknown/expired `state` handle fails verification.
	verify(req: unknown, handle: string, cb: (err: unknown, ok?: unknown) => void) {
		verifyOAuthState(handle).then((ok) => cb(null, ok), cb);
	},
};

// GitHub userinfo: https://api.github.com/user (token in the Authorization header).
{
	const strategy = strategyOf("github");
	strategy._oauth2.useAuthorizationHeaderforGET(true);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
	(strategy as unknown as Record<"_stateStore", unknown>)._stateStore = mongoStateStore;
	strategy.userProfile = function (accessToken, done) {
		this._oauth2.get("https://api.github.com/user", accessToken, (err, body) => {
			if (err) {
				done(err);
				return;
			}
			try {
				const json = z
					.object({
						id: z.union([z.string(), z.number()]).transform(String),
						login: z.string().optional(),
						html_url: z.string().optional(),
					})
					.parse(JSON.parse(typeof body === "string" ? body : "{}"));
				done(null, { id: json.id, username: json.login, profileUrl: json.html_url });
			} catch (e) {
				done(e);
			}
		});
	};
}

// ---------------------------------------------------------------------------
// Hugging Face via CIMD (Client ID Metadata Documents)
//
// CIMD is the elegant part of this login, not a workaround: HF advertises
// `client_id_metadata_document_supported: true`, so instead of a pre-registered
// OAuth app the client_id is the env's OWN `/.well-known/oauth-cimd` URL (served
// by the web app), which HF fetches+validates. CIMD mandates a public PKCE client
// (token_endpoint_auth_method "none") — no secret, no env, no registered redirect:
// each origin's doc names its own /auth/huggingface/callback, so prod AND every PR
// preview log in directly (no prod relay). Only constraint: the CIMD endpoint must
// be publicly reachable over HTTPS at `https://<host>/.well-known/oauth-cimd` (it
// is — nginx routes the public origin to the web app).
//
// Because the client_id is per-origin and passport bakes it into the strategy,
// strategies are built lazily and cached per origin. The other providers
// (google/discord/facebook/github) have no CIMD support — they keep their
// pre-registered apps with prod's fixed callback, so on preview envs their social
// login simply isn't wired up.
// ---------------------------------------------------------------------------
const hfStrategies = new Map<string, OAuth2StrategyInstance>();

function buildHuggingFaceStrategy(origin: string): OAuth2StrategyInstance {
	const strategy = new OAuth2Strategy(
		{
			authorizationURL: "https://huggingface.co/oauth/authorize",
			tokenURL: "https://huggingface.co/oauth/token",
			clientID: `${origin}/.well-known/oauth-cimd`,
			// CIMD public client: no secret (token_endpoint_auth_method "none").
			// @types/passport-oauth2 marks clientSecret required; undefined is correct at runtime.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			clientSecret: undefined as unknown as string,
			pkce: true,
			state: true,
			scope: ["openid", "profile"],
			passReqToCallback: true,
		},
		// @ts-expect-error -- our verify takes a minimal { user? } req (koa-passport's mock),
		// not express' full Request; structurally incompatible with the declared VerifyFunction.
		hfVerify,
	) as OAuth2StrategyInstance & OAuth2Internals;
	strategy._oauth2.useAuthorizationHeaderforGET(true);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
	(strategy as unknown as Record<"_stateStore", unknown>)._stateStore = mongoStateStore;
	strategy.userProfile = function (accessToken, done) {
		this._oauth2.get("https://huggingface.co/oauth/userinfo", accessToken, (err, body) => {
			if (err) {
				done(err);
				return;
			}
			try {
				const json = z
					.object({
						sub: z.union([z.string(), z.number()]).transform(String),
						preferred_username: z.string().optional(),
					})
					.parse(JSON.parse(typeof body === "string" ? body : "{}"));
				done(null, {
					id: json.sub,
					username: json.preferred_username,
					profileUrl: json.preferred_username ? `https://huggingface.co/${json.preferred_username}` : undefined,
				});
			} catch (e) {
				done(e);
			}
		});
	};
	return strategy;
}

/** The shared HF verify callback (link-or-create). Same logic as makeSocialStrategy's. */
function hfVerify(
	req: { user?: WithId<UserDoc> },
	_token: string,
	_tokenSecret: string,
	profile: SocialProfile,
	done: (err: unknown, user?: unknown) => void,
): void {
	void verifySocialProfile("huggingface", req, profile).then((user) => done(null, user), done);
}

/**
 * The Hugging Face strategy for a given request origin (its client_id is that origin's
 * CIMD URL). Used by routes/account/auth.ts via passport.authenticate(strategy, …).
 */
export function huggingfaceStrategy(origin: string): OAuth2StrategyInstance {
	let strategy = hfStrategies.get(origin);
	if (!strategy) {
		strategy = buildHuggingFaceStrategy(origin);
		hfStrategies.set(origin, strategy);
	}
	return strategy;
}

// The public origin the browser is talking to (the web app shares the API's origin via
// the vite proxy in dev / nginx in prod). koa-passport's req mock exposes `protocol` and
// `headers` but not `host`, so rebuild the origin from those. This origin determines the
// CIMD client_id (and must match the web page's origin that serves the CIMD doc).
export function requestOrigin(req: unknown): string {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport req mock
	const r = req as { protocol?: string; headers?: { host?: string } };
	return `${r.protocol}://${r.headers?.host}`;
}
