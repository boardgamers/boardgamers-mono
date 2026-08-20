import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { adminGrantSchema } from "./admin.ts";
import { zObjectId, zDate } from "./helpers.ts";

export const userSchema = z.object({
	_id: zObjectId().optional(),
	account: z.object({
		// No "@": login accepts email-or-username, and a "@" in a username would make
		// the two indistinguishable (and clash with the preview envs' sanitized
		// <username>@preview.invalid emails).
		username: z.string().regex(/^[^@]+$/, "Username can't contain @"),
		email: z.string().optional(),
		password: z.string().optional(),
		karma: z.number(),
		termsAndConditions: zDate().optional(),
		social: z
			.object({
				google: z.string().optional(),
				facebook: z.string().optional(),
				discord: z.string().optional(),
				github: z.string().optional(),
				huggingface: z.string().optional(),
			})
			.optional(),
		// Non-sensitive display info from the OAuth profile (public username + profile URL).
		// Never store tokens or the raw provider payload (profile._json) here. Intentionally
		// NOT whitelisted in infra/pr-preview/seed/scrub-users.mjs: identifying → previews drop it.
		socialMeta: z
			.object({
				google: z.object({ username: z.string(), url: z.string() }).optional(),
				facebook: z.object({ username: z.string(), url: z.string() }).optional(),
				discord: z.object({ username: z.string(), url: z.string() }).optional(),
				github: z.object({ username: z.string(), url: z.string() }).optional(),
				huggingface: z.object({ username: z.string(), url: z.string() }).optional(),
			})
			.optional(),
		avatar: z.string().optional(),
		bio: z.string().optional(),
		// 2-letter ISO 3166-1 alpha-2 code, user-chosen, shown in rankings/profile
		country: z
			.string()
			.regex(/^[a-zA-Z]{2}$/)
			.toUpperCase()
			.optional(),
	}),
	settings: z
		.object({
			mailing: z
				.object({
					newsletter: z.boolean().optional(),
					game: z
						.object({
							delay: z.number().optional(),
							activated: z.boolean().optional(),
						})
						.optional(),
				})
				.optional(),
			game: z
				.object({
					soundNotification: z.boolean().optional(),
				})
				.optional(),
			home: z
				.object({
					showMyGames: z.boolean().optional(),
					// Boardgames the player chose to hide from the "My games" sidebar group.
					// Cleared per-game when the player joins or creates a game of that boardgame.
					forgottenGames: z.array(z.string()).optional(),
				})
				.optional(),
			notifications: z
				.object({
					// Per-user outgoing webhook for your-turn notifications (#85/#33).
					webhook: z
						.object({
							// Secret-ish: anyone with the URL can post to the channel, so the
							// api strips it from responses and only exposes `hasWebhook`.
							url: z.string().optional(),
							format: z.enum(["discord", "slack", "raw"]).default("discord"),
							enabled: z.boolean().default(true),
							// Seconds to wait before posting, batching moves into one message.
							// 0 = immediate (on the turn event). Independent of the email
							// delay (settings.mailing.game.delay).
							delay: z.number().optional(),
							// Auto-set after 24h of continuous delivery failure; saving a new
							// URL resets it (along with failingSince/retryCount/nextRetryAt/lastError).
							disabled: z.boolean().optional(),
							failingSince: zDate().optional(),
							// Consecutive delivery failures — drives the exponential backoff.
							retryCount: z.number().optional(),
							nextRetryAt: zDate().optional(),
							lastError: z.string().optional(),
							// Serialization-only hint, computed by the api's stripSensitiveFields
							// (never stored): tells the UI a webhook is configured without
							// revealing the URL.
							hasWebhook: z.boolean().optional(),
						})
						.optional(),
				})
				.optional(),
		})
		.optional(),
	security: z.object({
		lastIp: z.string().optional(),
		lastLogin: z
			.object({
				ip: z.string(),
				date: zDate(),
			})
			.optional(),
		lastActive: zDate().optional(),
		lastOnline: zDate().optional(),
		// Bumped by the sliding-session middleware on mutating activity, and by OAuth
		// authorize/token (a "seen via SSO" signal). Feeds the dead-user cleanup.
		lastSeen: zDate().optional(),
		confirmed: z.boolean().optional(),
		// sha256 hex of the email-confirmation link secret (the emailed link carries the
		// plaintext). Legacy docs hold the plaintext until used / migration 1.4.0 (#164).
		confirmKey: z.string().nullable().optional(),
		// Last time an auth email (reset link / confirmation) was sent to this user —
		// shared per-email send cooldown (#195).
		lastAuthEmailSentAt: zDate().optional(),
		reset: z
			.object({
				// sha256 hex of the password-reset link secret (plaintext only in the email).
				key: z.string().nullable(),
				issued: zDate(),
			})
			.nullable()
			.optional(),
		slug: z.string().optional(),
	}),
	meta: z
		.object({
			nextGameNotification: zDate().optional(),
			lastGameNotification: zDate().optional(),
		})
		.optional(),
	authority: z.string().optional(),
	// Granular admin grants for scoped admins (global permissions + per-boardgame
	// `gameinfo:<gameId>` entries). Meaningless for full admins: authority ===
	// "admin" already implies every permission.
	adminGrants: z.array(adminGrantSchema).optional(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export type UserDoc = z.output<typeof userSchema>;
export type UserFront = Jsonify<UserDoc>;

export const USERS_COLLECTION = "users";

export const userIndexes: IndexDescription[] = [
	{ key: { "account.username": 1 }, unique: true, sparse: true },
	// api: login / registration lookup
	{ key: { "account.email": 1 }, unique: true, sparse: true },
	// api: social OAuth login
	{ key: { "account.social.google": 1 }, unique: true, sparse: true },
	// api: social OAuth login
	{ key: { "account.social.facebook": 1 }, unique: true, sparse: true },
	// api: social OAuth login
	{ key: { "account.social.discord": 1 }, unique: true, sparse: true },
	// api: social OAuth login
	{ key: { "account.social.github": 1 }, unique: true, sparse: true },
	// api: social OAuth login
	{ key: { "account.social.huggingface": 1 }, unique: true, sparse: true },
	// api: URL-based user lookup (profile pages)
	{ key: { "security.slug": 1 }, unique: true, sparse: true },
	// api: admin IP-based lookups
	{ key: { "security.lastIp": 1 } },
	// admin: list all admins / promote-demote
	{ key: { authority: 1 } },
	// admin: list scoped admins (users holding granular grants)
	{ key: { adminGrants: 1 }, sparse: true },
	// admin: online/connected user counts on dashboard
	{ key: { "security.lastOnline": 1 } },
];
