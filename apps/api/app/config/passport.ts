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
import { z } from "zod";
import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "./db.ts";
import { takePendingSignup } from "../models/oauthflows.ts";

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
				// Keep newUser.confirmKey as the stored HASH. The confirmation email embeds
				// the plaintext key, so hand the mailer a one-off copy carrying it rather
				// than mutating the doc passport returns downstream.
				const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };

				if (!newUser.security.confirmed) {
					await sendConfirmationEmail({ ...newUser, security: { ...newUser.security, confirmKey } });
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

				// Facebook phase-out: verifySocialProfile no longer emits facebook signup
				// tickets, but a signed legacy JWT could still carry one — reject it here too.
				if (decoded.provider === "facebook") {
					throw createError(403, facebookSignupClosed);
				}

				// create the user
				const slug = username.toLowerCase().replace(/\s+/g, "-");
				const social = { [decoded.provider]: decoded.socialId };
				const socialMeta = decoded.socialMeta ? { [decoded.provider]: decoded.socialMeta } : undefined;
				const newUserDoc: UserDoc = makeDefaultUser({
					username,
					// No email: providers may return none, and account.email must stay ABSENT
					// (never "") so the unique sparse index doesn't collide on "" (E11000).
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

// The social providers. GitHub and Hugging Face use hand-rolled PKCE (config/pkce.ts)
// and are NOT registered as passport strategies.
type SocialProvider = "discord" | "google" | "facebook" | "github" | "huggingface";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SocialStrategyCtor<T extends Strategy> = new (options: any, verify: any) => T;

// Passport profile shape is a superset; we only ever read these fields. `username` /
// `profileUrl` are optional because not every provider supplies them.
export type SocialProfile = {
	id: string;
	username?: string;
	profileUrl?: string;
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
	provider: Exclude<SocialProvider, "huggingface" | "github">,
	SocialStrategy: SocialStrategyCtor<T>,
) {
	const { id, secret } = env.social[provider];
	passport.use(
		provider,
		new SocialStrategy(
			{
				clientID: id,
				clientSecret: secret,
				passReqToCallback: true,
				// The api serves the callback at /auth/<provider>/callback (top-level
				// router, #248). Requires nginx to route /auth/* to the api and the
				// provider's OAuth app to list this redirect URI.
				callbackURL: `https://${env.site}/auth/${provider}/callback`,
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

// Facebook is being phased out (codeberg boardgamers/boardgamers#99, step 1): no NEW
// registrations or account links — existing facebook-linked accounts keep logging in
// until the cutover. 4xx http-errors are exposed to the user by the callback redirect
// (routes/auth.ts).
const facebookSignupClosed =
	"Facebook login is being phased out: new accounts can no longer sign up with Facebook. " +
	"Please sign up with an email address, or with Google, Discord, GitHub or Hugging Face.";
const facebookLinkClosed =
	"Facebook login is being phased out — connecting new Facebook accounts is no longer possible.";

// Link-or-create logic shared by every social login (passport strategies for
// discord/google/facebook, hand-rolled PKCE for github/huggingface). Resolves the
// OAuth profile to an existing user, links to the logged-in user, or yields a
// createSocialAccount feedback object for the signup flow.
export async function verifySocialProfile(
	provider: SocialProvider,
	req: { user?: WithId<UserDoc> },
	profile: SocialProfile,
): Promise<unknown> {
	const socialMeta = socialMetaOf(provider, profile);
	const currentUser = req.user;
	const existingUser = await colls.users.findOne({ [`account.social.${provider}`]: profile.id });

	// Facebook phase-out (step 1): a facebook id that matches no user would either
	// register a new account or link a new connection — both are closed. Matching is
	// strictly by social id (never by email), so every existing-user login stays intact.
	if (provider === "facebook" && !existingUser) {
		throw createError(403, currentUser ? facebookLinkClosed : facebookSignupClosed);
	}

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
