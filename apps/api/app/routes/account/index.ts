import assert from "node:assert";
import createError from "http-errors";
import Jimp from "jimp";
import type { Context } from "koa";
import passport from "koa-passport";
import Router from "koa-router";
import type { GamePreferencesDoc } from "@bgs/models";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { accessTokenDuration, createAccessToken, findGamesWithPlayersTurn, isUserAdmin } from "../../models/index.ts";
import { parseRefreshCookie, clearRefreshCookie } from "../../models/session.ts";
import {
	confirm,
	findByEmail,
	generateConfirmKey,
	generateResetLink,
	sendConfirmationEmail,
	sendMailChangeEmail,
	sendResetEmail,
	stripSensitiveFields,
} from "../../models/user.ts";
import type { ImageDoc } from "@bgs/models";
import { loggedIn, loggedOut } from "../utils.ts";
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
	assert(!avatar?.includes("/") && !avatar?.includes("."), "Invalid avatar");

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
	const image = await Jimp.read(input);

	const supportedMimes: readonly ("image/jpeg" | "image/png")[] = [Jimp.MIME_JPEG, Jimp.MIME_PNG];
	const detectedMime = image.getMIME();
	const mime: "image/jpeg" | "image/png" =
		supportedMimes.find((m) => m === detectedMime) ?? (image.hasAlpha() ? Jimp.MIME_PNG : Jimp.MIME_JPEG);

	const imagesObj: ImageDoc["images"] = {};
	for (const size of [256, 128, 64]) {
		if (image.getWidth() > size || image.getHeight() > size) {
			image.cover(size, size);
		} else if (image.getWidth() !== image.getHeight()) {
			image.cover(Math.max(image.getWidth(), image.getHeight()), Math.max(image.getWidth(), image.getHeight()));
		}
		const converted = await image.quality(85).getBufferAsync(mime);
		imagesObj[`${size}x${size}`] = { mime, raw: converted, size: converted.length };
	}

	await colls.images.updateOne(
		{ ref: ctx.state.user!._id, key: "avatar", refType: "User" },
		{
			$set: {
				images: imagesObj,
				formats: Object.keys(imagesObj),
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
				"security.confirmKey": confirmKey,
			},
		},
	);

	const updatedUser = await colls.users.findOne({ _id: user._id });
	if (updatedUser) {
		await sendConfirmationEmail(updatedUser);
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

router.post("/signout", (ctx: Context) => {
	ctx.logout();
	clearRefreshCookie(ctx);
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

	const rt = await colls.jwtRefreshTokens.findOne({ code });

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

	await generateResetLink(user);
	await sendResetEmail(user);
	ctx.status = 200;
});

export { sendAuthInfo };
export default router;
