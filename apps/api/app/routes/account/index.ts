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
	findGameInfoWithVersion,
	isAvatarStyle,
	isUserAdmin,
	lookupRefreshToken,
	markAuthEmailSent,
	revokeRefreshToken,
} from "../../models/index.ts";
import { parseRefreshCookie, clearRefreshCookie } from "../../models/session.ts";
import {
	confirm,
	deliverWebhook,
	findByEmail,
	generateConfirmKey,
	generateResetLink,
	hashUserSecret,
	sendConfirmationEmail,
	sendMailChangeEmail,
	sendResetEmail,
	stripSensitiveFields,
	type WebhookFormat,
} from "../../models/user.ts";
import type { ImageDoc } from "@bgs/models";
import sharp from "sharp";
import { loggedIn, loggedOut, rateLimitAttempt } from "../utils.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { resolveAllowedAddresses, assertSafeUrlScheme } from "../../services/safefetch.ts";
import { putAvatar, s3Enabled } from "../../services/s3.ts";
import { sendAuthInfo } from "./utils.ts";

const router = new Router<Application.DefaultState, Context>();

/**
 * Server-side SSRF validation for a user-supplied notification webhook URL (#85/#33):
 * it must parse, be https (loopback http tolerated only outside production) and
 * resolve to no special-use address. Throws assert/Error → 400.
 */
async function assertValidWebhookUrl(raw: unknown): Promise<void> {
	assert(typeof raw === "string" && raw.length > 0, "Invalid webhook url");
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		assert.fail("Invalid webhook url");
	}
	assertSafeUrlScheme(url, "Webhook url");
	await resolveAllowedAddresses(url.hostname);
}

// Shape of the settings.notifications.webhook sub-tree accepted by POST /api/account.
const webhookSettingsSchema = z
	.object({
		url: z.string().nullish(),
		format: z.enum(["discord", "slack", "raw"]).optional(),
		enabled: z.boolean().optional(),
		// Seconds before posting (0 = immediate). Independent of the email delay.
		delay: z.number().int().min(0).optional(),
	})
	.strict();

function webhookTestPayload(format: WebhookFormat): Record<string, unknown> {
	switch (format) {
		case "discord":
			return { content: "🎲 Test notification from boardgamers.space — your webhook works!" };
		case "slack":
			return { text: "🎲 Test notification from boardgamers.space — your webhook works!" };
		case "raw":
			return { event: "test" };
	}
}

router.get("/", loggedIn, (ctx) => {
	// Redact: ctx.state.user comes straight from Mongo (webhook url, secrets).
	ctx.body = stripSensitiveFields(ctx.state.user!);
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

	// Validate + normalize the webhook sub-tree BEFORE flattening: strict shape
	// (unknown keys rejected), url SSRF-checked, null/empty url ⇒ clear the block.
	// (oxlint-disable: settings is z.any() — the cast is the raw request payload)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const rawSettings = body.settings as Record<string, unknown> | undefined;
	const rawNotifications: unknown = rawSettings?.notifications;
	let webhookUpdate: { clear: true } | { set: Record<string, unknown>; urlChanged: boolean } | undefined;
	if (rawNotifications && typeof rawNotifications === "object" && "webhook" in rawNotifications) {
		const rawWebhook = rawNotifications.webhook;
		if (rawWebhook == null) {
			webhookUpdate = { clear: true };
		} else {
			const parsedWebhook = webhookSettingsSchema.parse(rawWebhook);
			if (parsedWebhook.url != null && parsedWebhook.url.trim() === "") {
				webhookUpdate = { clear: true };
			} else {
				if (parsedWebhook.url != null) {
					await assertValidWebhookUrl(parsedWebhook.url);
				}
				const urlChanged =
					parsedWebhook.url != null && parsedWebhook.url !== ctx.state.user!.settings?.notifications?.webhook?.url;
				const set: Record<string, unknown> = {};
				if (parsedWebhook.url != null) {
					set.url = parsedWebhook.url;
				}
				if (parsedWebhook.format !== undefined) {
					set.format = parsedWebhook.format;
				}
				if (parsedWebhook.enabled !== undefined) {
					set.enabled = parsedWebhook.enabled;
				}
				if (parsedWebhook.delay !== undefined) {
					set.delay = parsedWebhook.delay;
				}
				webhookUpdate = { set, urlChanged };
			}
		}
		// Handled here, not via the generic flatten (null must $unset, url state resets).
		delete rawNotifications.webhook;
		if (Object.keys(rawNotifications).length === 0) {
			delete rawSettings!.notifications;
		}
	}

	const updateFields: Record<string, unknown> = {};
	const unsetFields: Record<string, ""> = {};
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
	if (webhookUpdate) {
		const base = "settings.notifications.webhook";
		if ("clear" in webhookUpdate) {
			unsetFields[base] = "";
		} else {
			for (const [key, value] of Object.entries(webhookUpdate.set)) {
				updateFields[`${base}.${key}`] = value;
			}
			if (webhookUpdate.urlChanged) {
				// A new/changed url re-arms the webhook: reset the failure state.
				unsetFields[`${base}.disabled`] = "";
				unsetFields[`${base}.failingSince`] = "";
				unsetFields[`${base}.retryCount`] = "";
				unsetFields[`${base}.nextRetryAt`] = "";
				unsetFields[`${base}.lastError`] = "";
			}
		}
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

	if (Object.keys(updateFields).length > 0 || Object.keys(unsetFields).length > 0) {
		await colls.users.updateOne(
			{ _id: ctx.state.user!._id },
			{
				...(Object.keys(updateFields).length > 0 ? { $set: updateFields } : {}),
				...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
			},
		);
	}

	const updatedUser = await colls.users.findOne({ _id: ctx.state.user!._id });
	ctx.body = updatedUser ? stripSensitiveFields(updatedUser) : updatedUser;
});

/**
 * Send a test notification to the user's saved webhook (#85/#33): re-runs the
 * SSRF validation and does a real POST in the user's configured format, so they
 * can verify the URL before relying on it.
 */
router.post("/webhook/test", loggedIn, actionRateLimit("account/webhook/test"), async (ctx) => {
	const user = ctx.state.user!;
	const webhook = user.settings?.notifications?.webhook;
	if (!webhook?.url) {
		ctx.body = { success: false, error: "No webhook configured" };
		return;
	}
	try {
		await assertValidWebhookUrl(webhook.url);
		await deliverWebhook(user, webhookTestPayload(webhook.format ?? "discord"));
		ctx.body = { success: true };
	} catch (err) {
		ctx.body = { success: false, error: err instanceof Error ? err.message : String(err) };
	}
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

// Per-user cap on the email-change action itself (#195), counted in mongo —
// the limit is registered in ACTION_RATE_LIMITS (services/actionratelimit.ts).
// Complementary to the per-email cooldown of #233: that one limits outbound
// mail volume to an address, this one limits how often a user can hit the
// route at all.
router.post("/email", loggedIn, actionRateLimit("account/email"), async (ctx) => {
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
		// The confirmation email ALWAYS goes out on an email change: the change
		// applies immediately, so suppressing the send (per-email auth cooldown,
		// #233) would leave the account changed-but-unconfirmable. The throttle
		// for this route is the per-user action rate limit above; the #233
		// cooldown stays in charge of the unauthenticated routes (/forget, admin
		// resend-confirmation). Not stamping lastAuthEmailSentAt here keeps a
		// change from muting a later /forget to the new address, and its volume
		// is already bounded by the action limit.
		//
		// sendConfirmationEmail reads security.confirmKey to build the link — hand it
		// the plaintext (the db holds only the hash).
		updatedUser.security.confirmKey = confirmKey;
		await sendConfirmationEmail(updatedUser);
		ctx.body = stripSensitiveFields(updatedUser);
	}
});

router.post("/terms-and-conditions", loggedIn, async (ctx) => {
	assert(!ctx.state.user!.account.termsAndConditions, "You already accepted the Terms and Conditions");
	await colls.users.updateOne({ _id: ctx.state.user!._id }, { $set: { "account.termsAndConditions": new Date() } });
	const updatedUser = await colls.users.findOne({ _id: ctx.state.user!._id });
	ctx.body = updatedUser ? stripSensitiveFields(updatedUser) : updatedUser;
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
	const gameInfo = await findGameInfoWithVersion(ctx.params.game, +ctx.params.version);

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

// Email signup 409s on a taken email — an enumeration oracle, so it shares the
// per-IP limiter (same budget as login/forget/reset/confirm). /signup/social
// keys on provider identities, not email existence, so it is NOT rate-limited.
router.post("/signup", rateLimitAttempt, loggedOut, passport.authenticate("local-signup", { session: false }), (ctx) =>
	sendAuthInfo(ctx, "password"),
);

// The social-signup strategy attaches the provider as `loginMethod` on the returned user.
router.post("/signup/social", loggedOut, passport.authenticate("social-signup", { session: false }), sendAuthInfo);

router.post("/login", rateLimitAttempt, passport.authenticate("local-login", { session: false }), (ctx) =>
	sendAuthInfo(ctx, "password"),
);

router.post("/signout", async (ctx: Context) => {
	// Revoke server-side too — otherwise a leaked cookie keeps working until its 120-day expiry.
	const code = parseRefreshCookie(ctx.cookies.get("refreshToken"));
	if (code) {
		await revokeRefreshToken(code);
	}
	ctx.logout();
	clearRefreshCookie(ctx);
	ctx.status = 200;
});

router.post("/confirm", rateLimitAttempt, async (ctx: Context) => {
	const body = z.object({ email: z.string().email(), key: z.string() }).parse(ctx.request.body);
	const user = await findByEmail(body.email);

	if (!user) {
		throw createError(404, "Can't find user: " + body.email);
	}

	if (user.security.confirmed) {
		// JSON, not a redirect: this endpoint is consumed by fetch (the web confirm
		// page), and a 302 is followed into HTML that callers can't parse.
		ctx.state.user = user;
		await sendAuthInfo(ctx, "password");
		ctx.body = { ...ctx.body, alreadyConfirmed: true };
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

router.post("/reset", rateLimitAttempt, loggedOut, passport.authenticate("local-reset", { session: false }), (ctx) =>
	sendAuthInfo(ctx, "password"),
);

router.post("/forget", rateLimitAttempt, loggedOut, async (ctx: Context) => {
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
