import type { UserDoc, GameDoc } from "@bgs/models";
import assert from "node:assert";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { ObjectId, type WithId } from "mongodb";
import { z } from "zod";
import locks from "../config/locks.ts";
import { colls } from "../config/db.ts";
import { env } from "../config/index.ts";
import { sendMail, unsubscribePageUrl, unsubscribeScopes, type UnsubscribeScope } from "../services/mail.ts";
import { safeFetch } from "../services/safefetch.ts";
import { findGamesWithPlayersTurn } from "./game.ts";

export const defaultKarma = 75;
export const maxKarma = 100;

// 256 bits of randomness, URL-safe (base64url) — these become emailed link secrets.
const secureId = () => crypto.randomBytes(32).toString("base64url");

export function makeDefaultUser(params: {
	username: string;
	email?: string;
	slug: string;
	password: string;
	confirmKey: string;
	confirmed: boolean;
	newsletter: boolean;
	social?: { google?: string; facebook?: string; discord?: string; github?: string; huggingface?: string };
	socialMeta?: UserDoc["account"]["socialMeta"];
	authority?: string;
	adminGrants?: string[];
}): UserDoc {
	const now = new Date();
	return {
		account: {
			username: params.username,
			// Omit `email` when there is none (social signup without a provider email): the
			// unique sparse index on account.email only skips docs where the field is
			// ABSENT — a stored "" is indexed, so a second no-email signup collides
			// (E11000). Also, the driver serializes `undefined` as null.
			...(params.email ? { email: params.email } : {}),
			password: params.password,
			karma: defaultKarma,
			termsAndConditions: now,
			// Omit `social` when absent: the driver serializes `undefined` as null, and a
			// stored `social: null` breaks later `$set: { "account.social.<provider>" }` updates.
			...(params.social ? { social: params.social } : {}),
			...(params.socialMeta ? { socialMeta: params.socialMeta } : {}),
			avatar: "avataaars",
			bio: "",
		},
		settings: {
			mailing: { newsletter: params.newsletter, game: { delay: 30 * 60, activated: true } },
			game: { soundNotification: true },
			home: { showMyGames: false },
		},
		security: {
			lastIp: "",
			lastLogin: { ip: "", date: new Date(0) },
			lastActive: now,
			lastOnline: now,
			confirmed: params.confirmed,
			confirmKey: params.confirmKey,
			reset: { key: "", issued: new Date(0) },
			slug: params.slug,
		},
		meta: { nextGameNotification: new Date(0), lastGameNotification: new Date(0) },
		// Regular users carry no authority value (migration 1.4.2 $unset the legacy "user").
		...(params.authority ? { authority: params.authority } : {}),
		...(params.adminGrants?.length ? { adminGrants: params.adminGrants } : {}),
		createdAt: now,
		updatedAt: now,
	};
}

export const publicInfoProjection = {
	_id: 1,
	"account.username": 1,
	"account.bio": 1,
	"account.karma": 1,
	"account.country": 1,
	createdAt: 1,
} as const;

export async function findByEmail(email: string) {
	return colls.users.findOne({ "account.email": email.toLowerCase().trim() });
}

export async function findByUsername(name: string) {
	return colls.users.findOne({ "security.slug": name.toLowerCase().replace(/\s+/g, "-") });
}

export async function findByUrl(urlComponent: string) {
	return colls.users.findOne({ _id: new ObjectId(urlComponent) });
}

export function isAdmin(user: WithId<UserDoc>) {
	return user.authority === "admin";
}

export async function generateHash(password: string) {
	return bcrypt.hash(password, 8);
}

export async function validPassword(user: WithId<UserDoc>, password: string) {
	if (!user.account.password) {
		return false;
	}
	return bcrypt.compare(password, user.account.password);
}

export async function resetPassword(user: WithId<UserDoc>, password: string) {
	const hash = await generateHash(password);
	await Promise.all([
		colls.users.updateOne({ _id: user._id }, { $set: { "account.password": hash, "security.reset": null } }),
		// A password change can mean the account was compromised — revoke all
		// sessions; every device has to log in again with the new password.
		colls.jwtRefreshTokens.deleteMany({ user: user._id }),
	]);
}

export function generateConfirmKey(): string {
	return secureId();
}

// Single-use emailed secrets (confirm link, reset link) are 256 bits of randomness
// compared against user input then nulled on use, so a fast unsalted hash is safe —
// same pattern as admintokens.ts / refresh-token codes (#164).
export function hashUserSecret(secret: string): string {
	return crypto.createHash("sha256").update(secret).digest("hex");
}

// The emailed link carries the plaintext; only its hash is stored (migration
// 1.4.0 hashed the pre-#164 plaintext rows).
function secretMatches(stored: string | null | undefined, incoming: string): boolean {
	return !!stored && stored === hashUserSecret(incoming);
}

// --- Signed unsubscribe tokens (#2) ------------------------------------------

// Stateless HMAC token of `${userId}.${scope}` — the signature authenticates the
// emailed unsubscribe link without a login or any stored state. Keyed with the
// session secret (already deployed, rotation-worthy on leak).
function unsubscribeSignature(userId: string, scope: UnsubscribeScope): string {
	return crypto.createHmac("sha256", env.sessionSecret).update(`unsubscribe:${userId}.${scope}`).digest("base64url");
}

export function signUnsubscribeToken(userId: string, scope: UnsubscribeScope): string {
	return `${userId}.${scope}.${unsubscribeSignature(userId, scope)}`;
}

function asUnsubscribeScope(scope: string | undefined): UnsubscribeScope | null {
	for (const value of Object.values(unsubscribeScopes)) {
		if (value === scope) {
			return value;
		}
	}
	return null;
}

export function verifyUnsubscribeToken(token: string): { userId: string; scope: UnsubscribeScope } | null {
	const [userId, rawScope, signature, extra] = token.split(".");
	const scope = asUnsubscribeScope(rawScope);
	if (extra !== undefined || !ObjectId.isValid(userId ?? "") || !scope) {
		return null;
	}
	const expected = unsubscribeSignature(userId, scope);
	const a = Buffer.from(signature ?? "");
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
		return null;
	}
	return { userId, scope };
}

export function unsubscribeUrl(userId: string, scope: UnsubscribeScope): string {
	return unsubscribePageUrl(signUnsubscribeToken(userId, scope));
}

export async function applyUnsubscribe(userId: string, scope: UnsubscribeScope): Promise<void> {
	const update =
		scope === "newsletter"
			? { $set: { "settings.mailing.newsletter": false } }
			: { $set: { "settings.mailing.game.activated": false }, $unset: { "meta.nextGameNotification": "" as const } };
	await colls.users.updateOne({ _id: new ObjectId(userId) }, update);
}

export function validateResetKey(user: WithId<UserDoc>, key: string) {
	if (!user.security.reset || !user.security.reset.key) {
		throw new Error("This user didn't ask for a password reset.");
	}
	if (!key || !secretMatches(user.security.reset.key, key)) {
		throw new Error("The reset password link is wrong.");
	}
	const resetIssued = new Date(user.security.reset.issued);
	if (Date.now() - resetIssued.getTime() > 24 * 3600 * 1000) {
		throw new Error("The reset link has expired.");
	}
}

export async function confirm(user: WithId<UserDoc>, key: string) {
	assert(key && secretMatches(user.security.confirmKey, key), "Wrong confirm link.");
	await colls.users.updateOne({ _id: user._id }, { $set: { "security.confirmed": true, "security.confirmKey": null } });
}

// Per-email cooldown (#195): /forget and confirmation resends check this
// before mailing, so they can't be used to flood someone's inbox. (The
// logged-in email-change flow deliberately does NOT: the change applies
// immediately, so its confirmation email must always go out — the per-user
// action rate limit, services/actionratelimit.ts, throttles that route.)
// Callers must respond identically whether or not the email went out,
// must NOT regenerate the link secret on a skip (the first email's link must
// keep working), and must NOT stamp the cooldown on a skip — otherwise a
// flood would keep extending the window and lock out the legitimate owner.
// The mail-change notice to the old address is sent cooldown-free, so the
// confirm email in the same request is never blocked by it.
export function authEmailOnCooldown(user: UserDoc): boolean {
	const last = user.security.lastAuthEmailSentAt;
	return !!last && Date.now() - new Date(last).getTime() < env.authEmailCooldownMs;
}

export async function markAuthEmailSent(user: WithId<UserDoc>) {
	await colls.users.updateOne({ _id: user._id }, { $set: { "security.lastAuthEmailSentAt": new Date() } });
}

export async function generateResetLink(user: WithId<UserDoc>) {
	const key = secureId();
	const reset = { key: hashUserSecret(key), issued: new Date() };
	await colls.users.updateOne({ _id: user._id }, { $set: { "security.reset": reset } });
	// The in-memory doc keeps the PLAINTEXT key so sendResetEmail can put it in the
	// link — only the stored value is hashed.
	user.security.reset = { key, issued: reset.issued };
}

export async function recalculateKarma(user: WithId<UserDoc>, since = new Date(0)) {
	const playerGames = await colls.games
		.find(
			{ "players._id": user._id, lastMove: { $gte: since } },
			{ projection: { status: 1, cancelled: 1, players: 1 }, sort: { lastMove: 1 } },
		)
		.toArray();

	let karma = defaultKarma;

	for (const game of playerGames) {
		if (game.players.find((player) => player._id.equals(user._id))?.dropped) {
			karma -= 10;
		} else if (!game.cancelled && game.status === "ended") {
			karma = Math.min(karma + 1, maxKarma);
		}
	}

	user.account.karma = karma;
	await colls.users.updateOne({ _id: user._id }, { $set: { "account.karma": karma } });
}

export async function notifyLogin(user: WithId<UserDoc>, ip: string) {
	await colls.users.updateOne(
		{ _id: user._id },
		{ $set: { "security.lastLogin.date": new Date(), "security.lastLogin.ip": ip, "security.lastIp": ip } },
	);
}

export async function notifyLastIp(user: WithId<UserDoc>, ip: string) {
	const update: Record<string, unknown> = {};
	if (user.security.lastIp !== ip) {
		update["security.lastIp"] = ip;
	}
	if (!user.security.lastActive || Date.now() - new Date(user.security.lastActive).getTime() > 60 * 1000) {
		update["security.lastActive"] = new Date();
	}
	if (Object.keys(update).length > 0) {
		await colls.users.updateOne({ _id: user._id }, { $set: update });
	}
}

export function sendConfirmationEmail(user: WithId<UserDoc>) {
	assert(user.account.email, "Cannot send confirmation email: user has no email address");
	assert(user.security.confirmKey, "Cannot send confirmation email: user has no confirm key");
	return sendMail({
		kind: "confirm",
		to: user.account.email,
		subject: "Confirm your account",
		html: `
    <p>Hello, we're delighted to have a new Gaia Project player among us!</p>
    <p>To finish your registration and confirm your account with us at ${env.site},
     click <a href='https://${env.site}/confirm?key=${encodeURIComponent(user.security.confirmKey)}&email=${encodeURIComponent(user.account.email)}'>here</a>.</p>

    <p>If you didn't create an account with us, ignore this email.</p>`,
	});
}

export function sendResetEmail(user: WithId<UserDoc>) {
	assert(user.account.email, "Cannot send reset email: user has no email address");
	assert(user.security.reset?.key, "Cannot send reset email: user has no reset key");
	return sendMail({
		kind: "reset",
		to: user.account.email,
		subject: "Forgotten password",
		html: `
    <p>A password reset was asked for your account,
    click <a href='https://${env.site}/reset?key=${encodeURIComponent(user.security.reset.key)}&email=${encodeURIComponent(user.account.email)}'>here</a> to reset your password.</p>

    <p>If this didn't come from you, ignore this email.</p>`,
	});
}

export function sendMailChangeEmail(user: WithId<UserDoc>, newEmail: string) {
	if (!user.account.email) {
		return Promise.resolve();
	}

	return sendMail({
		kind: "mail-change",
		to: user.account.email,
		subject: "Mail change",
		html: `
    <p>Hello ${user.account.username},</p>
    <p>We're here to send you confirmation of your email change to ${escape(newEmail)}!</p>
    <p>If you didn't change your email, please contact us ASAP at ${env.contact}.</p>`,
	});
}

// --- Your-turn notification webhook (#85/#33) -------------------------------

export type WebhookFormat = "discord" | "slack" | "raw";

export interface WebhookCall {
	url: string;
	method: "POST";
	headers: Record<string, string>;
	body: string;
}

type WebhookFetch = (
	url: string,
	init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<unknown>;

const safeFetchPost: WebhookFetch = (url, init) =>
	safeFetch(url, { method: init.method, headers: init.headers, body: init.body });
let webhookFetch: WebhookFetch = safeFetchPost;

// Tests swap in a recorder to assert on outbound webhooks without network access.
export function setWebhookFetchForTests(mock: WebhookFetch | null) {
	webhookFetch = mock ?? safeFetchPost;
}

// Exponential backoff between delivery retries: 1min, doubling per consecutive
// failure, capped at 1h. After WEBHOOK_DISABLE_AFTER_MS of continuous failure
// the webhook is disabled until the user re-saves it.
export const WEBHOOK_BACKOFF_BASE_SECONDS = 60;
export const WEBHOOK_BACKOFF_MAX_SECONDS = 3600;
export const WEBHOOK_DISABLE_AFTER_MS = 24 * 3600 * 1000;

export function webhookBackoffSeconds(failureCount: number): number {
	return Math.min(WEBHOOK_BACKOFF_BASE_SECONDS * 2 ** Math.max(0, failureCount - 1), WEBHOOK_BACKOFF_MAX_SECONDS);
}

// game.name/version identify the GameInfo doc; label/basedOn are filled in from it by
// resolveGameLabels: label is the human-readable display name (the alias when the game
// has one, e.g. "Gem Trader"), basedOn the canonical game an alias derives from
// ("Splendor"). Both stay absent for games without a GameInfo doc.
export type WebhookGame = { _id: string; game: { name: string; version: number; label?: string; basedOn?: string } };

// game.version must be projected at every callsite that feeds a WebhookGame
// (findGamesWithPlayersTurn projects everything but `data`; gamenotification.ts
// projects "game.name" + "game.version").
const displayName = (game: WebhookGame) => game.game.label ?? game.game.name;

// One "Label (full game id)" entry per waiting game, so duplicates of the same
// game type are all listed and distinguishable.
function gameNames(games: WebhookGame[]): string {
	return games.map((g) => `${displayName(g)} (${String(g._id)})`).join(", ");
}

// Batch-fills game.label (+ game.basedOn for aliased games, issue #106) from the
// game metadata docs (one query for all the distinct games). Unknown games
// keep the slug as their name.
export async function resolveGameLabels<T extends WebhookGame>(games: T[]): Promise<T[]> {
	if (games.length === 0) {
		return games;
	}
	const keys = [...new Map(games.map((g) => [`${g.game.name}${g.game.version}`, g.game])).values()];
	// label/alias are game-level metadata (#298): one doc per game, shared across versions.
	const metas = await colls.gameMetadatas
		.find({ _id: { $in: keys.map((k) => k.name) } }, { projection: { label: 1, alias: 1 } })
		.toArray();
	const labels = new Map(
		metas.map((meta) => {
			const label = meta.alias ?? meta.label;
			return [meta._id, { label, basedOn: meta.alias ? meta.label : undefined }];
		}),
	);
	for (const game of games) {
		const resolved = labels.get(game.game.name);
		game.game.label = resolved?.label;
		game.game.basedOn = resolved?.basedOn;
	}
	return games;
}

export function buildWebhookPayload(
	format: WebhookFormat,
	user: UserDoc,
	games: WebhookGame[],
): Record<string, unknown> {
	const waiting = games.length;
	const names = gameNames(games);
	const waitingString = waiting === 1 ? "1 game waiting" : `${waiting} games waiting`;
	switch (format) {
		case "discord":
			return {
				content: `🎲 It's your turn in **${names}** (${waitingString})`,
				embeds: [{ title: `${names} — your turn`, url: `https://${env.site}/game/${games[0]._id}` }],
			};
		case "slack":
			return {
				text: `🎲 It's your turn in *${names}* (${waiting} waiting): https://${env.site}/user/${user.account.username}`,
			};
		case "raw":
			return {
				event: "turn",
				user: user.account.username,
				waitingCount: waiting,
				games: games.map((g) => ({
					id: g._id,
					game: g.game.name,
					name: displayName(g),
					...(g.game.basedOn ? { basedOn: g.game.basedOn } : {}),
					url: `https://${env.site}/game/${g._id}`,
				})),
			};
	}
}

/**
 * POST a payload to the user's configured webhook. Throws on any failure
 * (network error, non-2xx status) — callers persist the backoff state.
 */
export async function deliverWebhook(user: UserDoc, payload: Record<string, unknown>): Promise<unknown> {
	const webhook = user.settings?.notifications?.webhook;
	assert(webhook?.url, "Cannot deliver webhook: user has no webhook url");
	return webhookFetch(webhook.url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

/**
 * Fire the per-user your-turn webhook for the games waiting on them. No-op
 * unless the webhook is configured, enabled, not auto-disabled, and past its
 * retry backoff. Delivery state (failingSince / nextRetryAt / disabled /
 * lastError) is persisted on the user doc. Never throws into the caller: a
 * failing webhook must not break the email path.
 */
export async function deliverGameNotificationWebhook(freshUser: WithId<UserDoc>, activeGames: WebhookGame[]) {
	const webhook = freshUser.settings?.notifications?.webhook;
	// oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- explicit: undefined means enabled
	if (!webhook?.url || webhook.enabled === false || webhook.disabled) {
		return;
	}
	if (webhook.nextRetryAt && new Date(webhook.nextRetryAt) > new Date()) {
		return;
	}

	const base = "settings.notifications.webhook";
	try {
		const result: unknown = await deliverWebhook(
			freshUser,
			buildWebhookPayload(webhook.format ?? "discord", freshUser, await resolveGameLabels(activeGames)),
		);
		// The default fetch returns a SafeFetchResponse (status checked); test mocks
		// resolve undefined → success.
		if (result && typeof result === "object" && "statusCode" in result) {
			const statusCode = z.object({ statusCode: z.number() }).parse(result).statusCode;
			if (statusCode < 200 || statusCode >= 300) {
				throw new Error(`webhook returned status ${statusCode}`);
			}
		}
		// Success: reset the failure streak.
		await colls.users.updateOne(
			{ _id: freshUser._id },
			{
				$unset: {
					[`${base}.failingSince`]: "",
					[`${base}.retryCount`]: "",
					[`${base}.nextRetryAt`]: "",
					[`${base}.lastError`]: "",
					[`${base}.disabled`]: "",
				},
			},
		);
	} catch (err) {
		const now = new Date();
		const failingSince = webhook.failingSince ? new Date(webhook.failingSince) : now;
		// Consecutive-failure counter, doubled into the backoff interval. Legacy
		// docs (failingSince set before retryCount existed) count as one failure.
		const failureCount = webhook.failingSince ? (webhook.retryCount ?? 1) + 1 : 1;
		const set: Record<string, unknown> = {
			[`${base}.failingSince`]: failingSince,
			[`${base}.retryCount`]: failureCount,
			[`${base}.nextRetryAt`]: new Date(now.getTime() + webhookBackoffSeconds(failureCount) * 1000),
			[`${base}.lastError`]: err instanceof Error ? err.message : String(err),
		};
		if (now.getTime() - failingSince.getTime() > WEBHOOK_DISABLE_AFTER_MS) {
			set[`${base}.disabled`] = true;
		}
		await colls.users.updateOne({ _id: freshUser._id }, { $set: set });
	}
}

/**
 * Immediate variant (webhook.delay === 0): fire on the turn event, not the email
 * throttle. Called from processCurrentMove with the game that just became the
 * user's turn. Shares the backoff + 24h-disable + streak-reset logic; never
 * throws into the caller.
 */
export async function deliverGameNotificationWebhookImmediate(freshUser: WithId<UserDoc>, game: WebhookGame) {
	const webhook = freshUser.settings?.notifications?.webhook;
	// oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- explicit: undefined means enabled
	if (!webhook?.url || (webhook.delay ?? 0) !== 0 || webhook.enabled === false || webhook.disabled) {
		return;
	}
	await deliverGameNotificationWebhook(freshUser, [game]);
}

export async function sendGameNotificationEmail(user: WithId<UserDoc>) {
	await using _lock = await locks.lock("game-notification", user._id.toString());
	try {
		const freshUser = await colls.users.findOne({ _id: user._id });
		if (!freshUser) {
			return;
		}

		if (!freshUser.settings?.mailing?.game?.activated) {
			await colls.users.updateOne({ _id: user._id }, { $unset: { "meta.nextGameNotification": "" } });
			return;
		}

		if (!freshUser.meta?.nextGameNotification || freshUser.meta.nextGameNotification > new Date()) {
			return;
		}

		const count = await colls.games.countDocuments({
			currentPlayers: { $elemMatch: { _id: user._id, timerStart: { $lt: freshUser.meta.lastGameNotification } } },
			status: "active",
		});

		if (count > 0) {
			return;
		}

		const activeGames = await findGamesWithPlayersTurn(user._id).project<Omit<GameDoc, "data">>({ data: 0 }).toArray();

		if (activeGames.length === 0) {
			await colls.users.updateOne({ _id: user._id }, { $unset: { "meta.nextGameNotification": "" } });
			return;
		}

		let lastMove = new Date();
		for (const game of activeGames) {
			const timerStart = game.currentPlayers?.find((pl) => pl._id.equals(user._id))?.timerStart;
			if (timerStart && timerStart < lastMove) {
				lastMove = timerStart;
			}
		}

		const notificationDate = new Date(lastMove.getTime() + (freshUser.settings.mailing.game.delay || 30 * 60) * 1000);

		if (notificationDate > new Date()) {
			await colls.users.updateOne({ _id: user._id }, { $set: { "meta.nextGameNotification": notificationDate } });
			return;
		}

		const gameString = activeGames.length > 1 ? `${activeGames.length} games` : "one game";

		if (freshUser.account.email && freshUser.security.confirmed) {
			sendMail({
				kind: "your-turn",
				to: freshUser.account.email,
				subject: "Your turn",
				html: `
				<p>Hello ${freshUser.account.username}</p>
				<p>It's your turn on ${gameString},
				click <a href='https://${env.site}/user/${encodeURIComponent(freshUser.account.username)}'>here</a> to see your active games.</p>`,
				unsubscribeToken: signUnsubscribeToken(freshUser._id.toHexString(), "game"),
			}).catch(console.error);
		}

		// Independent of the email path: a failing webhook must never affect the mail.
		// Only batched webhooks (delay > 0) ride this throttled pass; immediate ones
		// fire on the turn event (processCurrentMove).
		if ((freshUser.settings?.notifications?.webhook?.delay ?? 0) > 0) {
			await deliverGameNotificationWebhook(freshUser, activeGames).catch(console.error);
		}

		await colls.users.updateOne(
			{ _id: user._id },
			{ $set: { "meta.lastGameNotification": new Date() }, $unset: { "meta.nextGameNotification": "" } },
		);
	} catch (err) {
		console.error(err);
	}
}

export function stripSensitiveFields(user: WithId<UserDoc>): WithId<UserDoc> {
	const { password: _password, ...accountRest } = user.account;
	// hasPassword mirrors hasWebhook below: a serialization-only hint (never stored)
	// so the UI can tell whether unlinking a social login would drop the last login
	// method without ever seeing the hash.
	const account = { ...accountRest, ...(user.account.password ? { hasPassword: true } : {}) };
	if (!user.security) {
		return { ...user, account: { ...account } };
	}
	const { confirmKey: _confirmKey, reset, ...securityRest } = user.security;
	const resetWithoutKey = reset
		? (() => {
				const { key: _key, ...rest } = reset;
				return { ...rest, key: null };
			})()
		: undefined;

	// The webhook URL is secret-ish (whoever has it can post to the channel): never
	// let it leave the api — replace it with a `hasWebhook` hint for the UI. Copy,
	// never mutate the stored doc.
	let settings = user.settings;
	const webhook = settings?.notifications?.webhook;
	if (webhook) {
		const { url: _url, ...webhookWithoutUrl } = webhook;
		settings = {
			...settings,
			notifications: {
				...settings!.notifications,
				webhook: { ...webhookWithoutUrl, ...(webhook.url ? { hasWebhook: true } : {}) },
			},
		};
	}

	return {
		...user,
		account: { ...account },
		settings,
		security: { ...securityRest, reset: resetWithoutKey },
	};
}

export function userPublicInfo(user: WithId<UserDoc>) {
	return {
		_id: user._id,
		account: {
			username: user.account?.username,
			bio: user.account?.bio,
			karma: user.account?.karma,
			country: user.account?.country,
		},
		createdAt: user.createdAt,
	};
}
