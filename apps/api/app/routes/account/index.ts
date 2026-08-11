import assert from "node:assert";
import { createHash } from "node:crypto";
import createError from "http-errors";
import type { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import type { GamePreferencesDoc } from "@bgs/models";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import {
	accessTokenDuration,
	authEmailOnCooldown,
	createAccessToken,
	findGamesWithPlayersTurn,
	isAvatarStyle,
	isUserAdmin,
	lookupRefreshToken,
	markAuthEmailSent,
	revokeRefreshToken,
} from "../../models/index.ts";
import { parseRefreshCookie, clearRefreshCookie } from "../../models/session.ts";
import { clearForumSsoCookie } from "../../models/forumsso.ts";
import {
	confirm,
	findByEmail,
	generateConfirmKey,
	generateResetLink,
	hashUserSecret,
	sendConfirmationEmail,
	sendMailChangeEmail,
	sendResetEmail,
	stripSensitiveFields,
} from "../../models/user.ts";
import type { ImageDoc } from "@bgs/models";
import sharp from "sharp";
import { loggedIn, loggedOut } from "../utils.ts";
import { putAvatar, s3Enabled } from "../../services/s3.ts";
import auth from "./auth.ts";
import { sendAuthInfo } from "./utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.use("/auth", auth.routes(), auth.allowedMethods());

router.get("/", loggedIn, (ctx) => {
	ctx.body = ctx.state.user;
});

router.get("/active-games", async (ctx) => {
	if (!ctx.state.user?._id) {
		ctx.body = [];
	} else {
		const games = await findGamesWithPlayersTurn(ctx.state.user._id).project({ _id: 1 }).toArray();
		ctx.body = games.map((game) => game._id);
	}
});

router.post("/", loggedIn, async (ctx) => {
	const body = z
		.object({
			settings: z.any().optional(),
			account: z
				.object({
					avatar: z.string().optional(),
					bio: z.string().optional(),
					country: z
						.string()
						.regex(/^[a-zA-Z]{2}$/)
						.toUpperCase()
						.or(z.literal(""))
						.optional(),
				})
				.optional(),
		})
		.parse(ctx.request.body);

	const avatar = body.account?.avatar;
	assert(avatar == null || avatar === "upload" || isAvatarStyle(avatar), "Invalid avatar");

	const updateFields: Record<string, unknown> = {};
	if (body.settings != null) {
		// Merge leaf-by-leaf via dot-notation so a partial update (e.g. just
		// home.forgottenGames) doesn't clobber sibling settings or sub-keys.
		const flatten = (obj: Record<string, unknown>, prefix: string) => {
			for (const [key, value] of Object.entries(obj)) {
				const path = prefix ? `${prefix}.${key}` : key;
				if (value && typeof value === "object" && !Array.isArray(value)) {
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded to a plain object above
					flatten(value as Record<string, unknown>, path);
				} else {
					updateFields[`settings.${path}`] = value;
				}
			}
		};
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- settings is a partial settings tree
		flatten(body.settings as Record<string, unknown>, "");
	}
	if (body.account?.avatar != null) {
		updateFields["account.avatar"] = body.account.avatar;
	}
	if (body.account?.bio != null) {
		updateFields["account.bio"] = body.account.bio;
	}
	if (body.account?.country != null) {
		updateFields["account.country"] = body.account.country === "" ? null : body.account.country;
	}

	if (Object.keys(updateFields).length > 0) {
		await colls.users.updateOne({ _id: ctx.state.user!._id }, { $set: updateFields });
	}

	const updatedUser = await colls.users.findOne({ _id: ctx.state.user!._id });
	ctx.body = updatedUser;
});

router.post("/avatar", loggedIn, async (ctx) => {
	const parts = [];
	for await (const chunk of ctx.req) {
		parts.push(chunk);
	}

	const input = Buffer.concat(parts);
	const image = sharp(input);

	const mime = "image/webp";
	const imagesObj: ImageDoc["images"] = {};
	for (const size of [256, 128, 64]) {
		const converted = await image.clone().resize(size, size, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
		// Hash once here so the avatar route can use it as the ETag without
		// re-reading/re-hashing the blob on every request.
		const hash = createHash("sha256").update(converted).digest("hex").slice(0, 16);
		imagesObj[`${size}x${size}`] = { mime, raw: converted, size: converted.length, hash };
	}

	// S3-only write when enabled: on success the images doc is the metadata/etag
	// record (hash+mime+size per size, no `raw` blob) and the bytes live only in
	// S3. On any S3 failure (or S3 disabled) the mongo doc keeps the blobs and
	// stays unflagged, serving exactly as before — upload never breaks.
	let s3Stored = false;
	if (s3Enabled()) {
		s3Stored = true;
		for (const [size, data] of Object.entries(imagesObj)) {
			s3Stored = (await putAvatar(ctx.state.user!._id.toHexString(), size, data.raw!)) && s3Stored;
		}
		if (!s3Stored) {
			console.warn(
				`avatar S3 write incomplete for ${ctx.state.user!._id.toHexString()} — storing blobs in mongo instead`,
			);
		}
	}

	if (s3Stored) {
		for (const data of Object.values(imagesObj)) {
			delete data.raw;
		}
	}

	await colls.images.updateOne(
		{ ref: ctx.state.user!._id, key: "avatar", refType: "User" },
		{
			$set: {
				images: imagesObj,
				formats: Object.keys(imagesObj),
				...(s3Stored ? { s3: true } : {}),
			},
		},
		{ upsert: true },
	);
	await colls.users.updateOne({ _id: ctx.state.user!._id }, { $set: { "account.avatar": "upload" } });

	ctx.status = 200;
});

router.post("/email", loggedIn, async (ctx) => {
	const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
	const user = ctx.state.user!;

	const foundUser = await findByEmail(email);

	if (foundUser) {
		if (foundUser._id.equals(user._id)) {
			ctx.body = user;
			return;
		}

		throw createError(400, "Another user with that email address already exists");
	}

	await colls.logs.insertOne({
		kind: "mailChange",
		data: { player: user._id, change: { from: user.account.email, to: email } },
	});

	sendMailChangeEmail(user, email).catch(console.error);

	const confirmKey = generateConfirmKey();
	await colls.users.updateOne(
		{ _id: user._id },
		{
			$set: {
				"account.email": email,
				"security.confirmed": false,
				// Only the hash is stored (#164); the plaintext goes in the emailed link.
				"security.confirmKey": hashUserSecret(confirmKey),
			},
		},
	);

	const updatedUser = await colls.users.findOne({ _id: user._id });
	if (updatedUser) {
		// Auth-email cooldown (#195): skip only the send — the email change itself
		// still happens. Don't stamp the cooldown on a skip: the mail-CHANGE notice
		// above is sent to the old address without stamping, so a skipped confirm
		// email can be triggered again right away.
		if (!authEmailOnCooldown(updatedUser)) {
			// sendConfirmationEmail reads security.confirmKey to build the link — hand it
			// the plaintext (the db holds only the hash).
			updatedUser.security.confirmKey = confirmKey;
			await sendConfirmationEmail(updatedUser);
			await markAuthEmailSent(updatedUser);
		}
		ctx.body = stripSensitiveFields(updatedUser);
	}
});

router.post("/terms-and-conditions", loggedIn, async (ctx) => {
	assert(!ctx.state.user!.account.termsAndConditions, "You already accepted the Terms and Conditions");
	await colls.users.updateOne({ _id: ctx.state.user!._id }, { $set: { "account.termsAndConditions": new Date() } });
	const updatedUser = await colls.users.findOne({ _id: ctx.state.user!._id });
	ctx.body = updatedUser;
});

router.get("/games/settings", loggedIn, async (ctx) => {
	ctx.body = await colls.gamePreferences.find({ user: ctx.state.user!._id }).toArray();
});

router.get("/games/:game/settings", loggedIn, async (ctx) => {
	let pref = await colls.gamePreferences.findOne({ user: ctx.state.user!._id, game: ctx.params.game });

	if (!pref) {
		const newPref: GamePreferencesDoc = {
			user: ctx.state.user!._id,
			game: ctx.params.game,
			access: { ownership: false },
		};
		await colls.gamePreferences.insertOne(newPref);
		pref = (await colls.gamePreferences.findOne({ user: ctx.state.user!._id, game: ctx.params.game }))!;
	}

	// Unstringify stringified preferences
	const stringifiedSchema = z.object({ stringified: z.literal(true), value: z.string().optional() });
	if (pref.preferences) {
		for (const key in pref.preferences) {
			const parsed = stringifiedSchema.safeParse(pref.preferences[key]);
			if (parsed.success) {
				pref.preferences[key] = parsed.data.value !== undefined ? JSON.parse(parsed.data.value) : undefined;
			}
		}
	}

	ctx.body = pref;
});

router.post("/games/:game/ownership", loggedIn, async (ctx) => {
	const { access } = z.object({ access: z.object({ ownership: z.boolean() }) }).parse(ctx.request.body);
	const count = await colls.gameInfos.countDocuments({ "_id.game": ctx.params.game });

	if (!count) {
		return;
	}

	await colls.gamePreferences.updateOne(
		{
			user: ctx.state.user!._id,
			game: ctx.params.game,
		},
		{
			$set: {
				"access.ownership": access.ownership,
			},
		},
		{
			upsert: true,
		},
	);

	ctx.status = 200;
});

router.post("/games/:game/preferences/:version", loggedIn, async (ctx) => {
	const body = z
		.record(z.string(), z.unknown())
		.and(z.object({ alternateUI: z.boolean().optional() }))
		.parse(ctx.request.body);
	const gameInfo = await colls.gameInfos.findOne({ _id: { game: ctx.params.game, version: +ctx.params.version } });

	if (!gameInfo) {
		return;
	}

	const newPrefs: Record<string, boolean | string | { stringified: true; value: string }> = {};

	for (const pref of gameInfo.preferences ?? []) {
		const newVal = body[pref.name];
		if (pref.type === "checkbox") {
			newPrefs[pref.name] = !!newVal;
		} else if (pref.type === "select") {
			newPrefs[pref.name] =
				typeof newVal === "string" && pref.items!.some((it) => it.name === newVal) ? newVal : pref.items![0].name;
		} else if (pref.type === "hidden") {
			newPrefs[pref.name] = {
				value: JSON.stringify(newVal),
				stringified: true,
			};
		} else {
			// not handled
		}
	}

	if (gameInfo.viewer?.alternate?.url) {
		newPrefs.alternateUI = !!body.alternateUI;
	}

	await colls.gamePreferences.updateOne(
		{
			user: ctx.state.user!._id,
			game: ctx.params.game,
		},
		{
			$set: {
				preferences: newPrefs,
			},
		},
		{
			upsert: true,
		},
	);

	ctx.status = 200;
});

router.post("/signup", loggedOut, passport.authenticate("local-signup", { session: false }), (ctx) =>
	sendAuthInfo(ctx, "password"),
);

// The social-signup strategy attaches the provider as `loginMethod` on the returned user.
router.post("/signup/social", loggedOut, passport.authenticate("social-signup", { session: false }), sendAuthInfo);

router.post("/login", passport.authenticate("local-login", { session: false }), (ctx) => sendAuthInfo(ctx, "password"));

router.post("/signout", async (ctx: Context) => {
	// Revoke server-side too — otherwise a leaked cookie keeps working until its 120-day expiry.
	const code = parseRefreshCookie(ctx.cookies.get("refreshToken"));
	if (code) {
		await revokeRefreshToken(code);
	}
	ctx.logout();
	clearRefreshCookie(ctx);
	// Clear the forum SSO cookie on the spot — both the domain and host-only variants,
	// or a stale one shadows future logins on the forum (#152). The flag keeps the
	// post-response middleware from re-clearing it (it can't see our Set-Cookie
	// headers, and its host-only variant would shrink the dual-domain clear).
	ctx.state.forumSsoCookieCleared = true;
	clearForumSsoCookie(ctx);
	ctx.status = 200;
});

router.post("/confirm", async (ctx: Context) => {
	const body = z.object({ email: z.string().email(), key: z.string() }).parse(ctx.request.body);
	const user = await findByEmail(body.email);

	if (!user) {
		throw createError(404, "Can't find user: " + body.email);
	}

	if (user.security.confirmed) {
		ctx.redirect("/login");
		return;
	}

	await confirm(user, body.key);

	const updatedUser = await colls.users.findOne({ _id: user._id });
	ctx.state.user = updatedUser;

	await sendAuthInfo(ctx, "password");
});

const mintBodySchema = z.object({ code: z.string().optional(), scopes: z.array(z.string()).optional() });

/**
 * Mint a short-lived access token. The refresh code comes from the request body
 * (legacy/API clients) or the session cookie (web). Used mainly to obtain a
 * narrowly-scoped token (e.g. "gameplay") for the game-server.
 */
async function mintAccessToken(ctx: Context) {
	const { code: bodyCode, scopes } = mintBodySchema.parse(ctx.request.body);
	const code = bodyCode ?? parseRefreshCookie(ctx.cookies.get("refreshToken"));

	if (!code) {
		throw createError(401, "No refresh token (body or session cookie)");
	}

	const rt = await lookupRefreshToken(code);

	if (!rt) {
		throw createError(404, "Can't find refresh token");
	}

	const user = await colls.users.findOne({ _id: rt.user });
	if (!user) {
		throw createError(404, "User not found");
	}

	ctx.body = {
		code: await createAccessToken(rt, scopes, isUserAdmin(user)),
		expiresAt: Date.now() + accessTokenDuration(),
	};
}

router.post("/mint", mintAccessToken);

// DEPRECATED: use /account/mint. Kept for the old web app / external clients during
// the auth migration — remove once nothing calls /refresh anymore.
router.post("/refresh", mintAccessToken);

router.post("/reset", loggedOut, passport.authenticate("local-reset", { session: false }), (ctx) =>
	sendAuthInfo(ctx, "password"),
);

router.post("/forget", loggedOut, async (ctx: Context) => {
	const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
	const user = await findByEmail(email);

	if (!user) {
		throw createError(404, "Utilisateur introuvable: " + email);
	}

	// Same 200 whether or not the email goes out; on a cooldown skip we don't
	// regenerate the key, so the first email's link keeps working (#195).
	if (!authEmailOnCooldown(user)) {
		await generateResetLink(user);
		await sendResetEmail(user);
		await markAuthEmailSent(user);
	}
	ctx.status = 200;
});

export { sendAuthInfo };
export default router;
