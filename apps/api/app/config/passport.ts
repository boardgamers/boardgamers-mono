import assert from "node:assert";
import crypto from "node:crypto";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
// @ts-ignore - passport types
import type { Strategy } from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
// No maintained passport-huggingface package exists: the generic OAuth2 strategy works
// because Hugging Face implements plain OAuth2/OIDC (userinfo endpoint is set below via
// the strategy's userProfile override).
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { z } from "zod";
import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "./db.ts";
import {
	findByEmail,
	findByUsername,
	generateConfirmKey,
	generateHash,
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
					confirmKey,
					confirmed: false,
					newsletter: req.body.newsletter === true || req.body.newsletter === "true",
				});

				const result = await colls.users.insertOne(newUserDoc);
				const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };

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
				const { jwt: token } = req.body;

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

				const decoded = z
					.object({
						id: z.string(),
						provider: z.enum(["google", "facebook", "discord", "github", "huggingface"]),
						createSocialAccount: z.literal(true),
						socialMeta: z.object({ username: z.string(), url: z.string() }).optional(),
					})
					.parse(jwt.verify(token, env.jwt.keys.public));

				// create the user
				const slug = username.toLowerCase().replace(/\s+/g, "-");
				const social = { [decoded.provider]: decoded.id };
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

type SocialProvider = keyof typeof env.social;

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

// Extra strategy constructor options for providers configured on a generic strategy
// (HF on passport-oauth2, which requires its endpoints at construction).
const extraStrategyOptions: Partial<Record<SocialProvider, Record<string, unknown>>> = {
	huggingface: {
		authorizationURL: "https://huggingface.co/oauth/authorize",
		tokenURL: "https://huggingface.co/oauth/token",
		// PKCE public client (passport-oauth2 >= 1.7): S256 code challenge, no client
		// secret needed. `state: true` is required by passport-oauth2 when pkce is on
		// (it stores the code verifier against a CSRF state handle).
		pkce: true,
		state: true,
		// New-user redirects on login-linking flows (HF may register a fresh app user).
		scope: ["openid", "profile"],
	},
};

// Providers using a PKCE public client may omit the client secret entirely.
const secretOptional: Partial<Record<SocialProvider, true>> = {
	huggingface: true,
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

function makeSocialStrategy<T extends Strategy>(provider: SocialProvider, SocialStrategy: SocialStrategyCtor<T>) {
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
				// PKCE public clients (HF) pass no secret; confidential clients require one.
				clientSecret: secret,
				passReqToCallback: true,
				callbackURL: `https://${env.site}/auth/${provider}/callback`,
				...extraStrategyOptions[provider],
			},
			async function (
				req: { user?: WithId<UserDoc> },
				_token: string,
				_tokenSecret: string,
				profile: SocialProfile,
				done: (err: unknown, user?: unknown) => void,
			) {
				try {
					const socialMeta = socialMetaOf(provider, profile);
					const currentUser = req.user;
					const existingUser = await colls.users.findOne({ [`account.social.${provider}`]: profile.id });

					if (currentUser) {
						if (existingUser && existingUser._id.equals(currentUser._id)) {
							done(null, existingUser);
							return;
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
						const updatedUser = await colls.users.findOne({ _id: currentUser._id });
						done(null, updatedUser);
					} else {
						if (existingUser) {
							// Backfill display meta for accounts linked before socialMeta existed.
							if (socialMeta && !existingUser.account.socialMeta?.[provider]) {
								await colls.users.updateOne(
									{ _id: existingUser._id },
									{ $set: { [`account.socialMeta.${provider}`]: socialMeta } },
								);
							}
							done(null, existingUser);
						} else {
							// Create a new account (omit socialMeta when absent: it rides in a JWT and the
							// signup body schema, where an explicit undefined would needlessly differ).
							done(null, {
								createSocialAccount: true,
								provider,
								id: profile.id,
								...(socialMeta ? { socialMeta } : {}),
							});
						}
					}
				} catch (err) {
					done(err);
				}
			},
		),
	);
}

makeSocialStrategy("discord", DiscordStrategy);
makeSocialStrategy("google", GoogleStrategy);
makeSocialStrategy("facebook", FacebookStrategy);
makeSocialStrategy("github", GitHubStrategy);
makeSocialStrategy("huggingface", OAuth2Strategy);

// Hugging Face has no dedicated passport strategy: configure the generic OAuth2 strategy
// with HF's endpoints and teach it to read the profile from the OIDC userinfo payload.
{
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose _strategy
	const strategy = (passport as unknown as { _strategy(name: string): unknown })._strategy(
		"huggingface",
	) as InstanceType<typeof OAuth2Strategy>;
	// OAuth2Strategy types _oauth2 as protected; reach it via a structural cast.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const oauth2 = (strategy as unknown as Record<"_oauth2", { useAuthorizationHeaderforGET(v: boolean): void }>)._oauth2;
	oauth2.useAuthorizationHeaderforGET(true);

	// The default PKCE state store keeps the code verifier in `req.session`, which
	// this app doesn't have. This store keeps the same CSRF model (random handle in
	// the OAuth `state` param, verified on callback) but persists server-side instead,
	// and carries the relay `returnTo` origin along so the callback can bounce back to
	// the requesting environment. See routes/account/auth.ts for the relay flow.
	type RelayStatePayload = { codeVerifier: string; returnTo?: string };
	const relayStates = new Map<string, { payload: RelayStatePayload; expiresAt: number }>();
	// returnTo values of states that passed verification but whose callback route hasn't
	// consumed them yet (passport-oauth2 doesn't surface the store's payload to the route).
	const verifiedStates = new Map<string, { returnTo?: string; expiresAt: number }>();
	const STATE_TTL_MS = 15 * 60 * 1000;

	const pruneStates = () => {
		const now = Date.now();
		for (const [handle, entry] of relayStates) {
			if (entry.expiresAt <= now) {
				relayStates.delete(handle);
			}
		}
		for (const [handle, entry] of verifiedStates) {
			if (entry.expiresAt <= now) {
				verifiedStates.delete(handle);
			}
		}
	};

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
	(strategy as unknown as Record<"_stateStore", unknown>)._stateStore = {
		store(
			req: unknown,
			verifier: string,
			_state: unknown,
			_meta: unknown,
			cb: (err: unknown, handle?: string) => void,
		) {
			try {
				pruneStates();
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport passes a query-bearing req mock
				const query = (req as { query?: unknown }).query;
				const { returnTo } = z.object({ returnTo: z.string().url().optional() }).parse(query);
				const handle = crypto.randomBytes(24).toString("base64url");
				relayStates.set(handle, {
					payload: { codeVerifier: verifier, returnTo },
					expiresAt: Date.now() + STATE_TTL_MS,
				});
				cb(null, handle);
			} catch (err) {
				cb(err);
			}
		},
		// passport-oauth2 branches on arity: 4 params → meta variant, which treats the 3rd
		// callback arg as the info object passed to fail() — not our state payload. Declare 3.
		// Single-use: an unknown/expired `state` handle fails verification.
		verify(req: unknown, handle: string, cb: (err: unknown, ok?: unknown) => void) {
			pruneStates();
			const entry = typeof handle === "string" ? relayStates.get(handle) : undefined;
			relayStates.delete(handle);
			if (!entry || entry.expiresAt <= Date.now()) {
				cb(null, false);
				return;
			}
			verifiedStates.set(handle, { returnTo: entry.payload.returnTo, expiresAt: entry.expiresAt });
			cb(null, entry.payload.codeVerifier);
		},
	};

	// Consumed (single-use) by the callback route in routes/account/auth.ts.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- augmenting the passport singleton
	(passport as unknown as { consumeRelayReturnTo(h: unknown): string | undefined }).consumeRelayReturnTo = (
		handle: unknown,
	): string | undefined => {
		if (typeof handle !== "string") {
			return undefined;
		}
		const entry = verifiedStates.get(handle);
		verifiedStates.delete(handle);
		return entry && entry.expiresAt > Date.now() ? entry.returnTo : undefined;
	};
	strategy.userProfile = function (accessToken: string, done: (err?: unknown, profile?: unknown) => void) {
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
}
