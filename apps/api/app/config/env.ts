import fs from "node:fs";
import { parseEnv } from "node:util";

// Load .env files before reading process.env below. This must live here, not in the
// entrypoint: ESM hoists imports, so a loadEnvFile call in server.ts would only run
// after this module already read process.env. PM2 cluster mode also drops node_args
// (--env-file) when forking workers, so loading in-process is the only path that works
// everywhere. Paths resolve relative to this module (app/config → package root), not
// cwd. Real environment variables take precedence over file values (??=), matching
// --env-file-if-exists semantics.
for (const name of [".env", `.env.${process.env.NODE_ENV ?? "development"}`]) {
	const url = new URL(`../../${name}`, import.meta.url);
	if (fs.existsSync(url)) {
		for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(url, "utf8")))) {
			process.env[key] ??= value;
		}
	}
}

const domain = process.env.domain || "boardgamers.space";
let dbName = process.env.dbName ?? "bgs";

if (process.env.NODE_ENV === "test") {
	dbName += "-test";
} else if (process.env.NODE_ENV !== "production") {
	dbName += "-dev";
}

export default {
	script: false,
	domain,
	// Canonical site host (#153): the apex. Drives social OAuth callback URLs and
	// email links. Until nginx makes the apex canonical (www still is), set
	// site=www.boardgamers.space in the prod env to roll back.
	site: process.env.site || domain,
	// Base URL of the web app (login page, consent page). The OAuth2 authorize
	// endpoint redirects there when the caller has no session or no recorded consent.
	webAppUrl:
		process.env.webAppUrl || (process.env.NODE_ENV === "production" ? `https://${domain}` : "http://localhost:8612"),
	oauth2: {
		// OIDC issuer identifier. In production it MUST be the canonical site origin so
		// it matches the discovery doc served at /.well-known/openid-configuration.
		issuer: process.env.oauth2Issuer || (process.env.NODE_ENV === "production" ? `https://${domain}` : ""),
		// First-party trusted clients (#196's escape hatch): these CIMD client_id URLs
		// skip the consent screen for every user — they're operated by us and can't
		// meaningfully consent to themselves. The per-user `trusted` doc flag in
		// oauthconsents.ts stays as the out-of-band variant.
		trustedClients: (
			process.env.trustedOauthClients ??
			"https://forum.boardgamers.space/client-metadata.json,https://grafana.boardgamers.space/client-metadata.json"
		)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	},
	noreply: process.env.noreply || `BGS <no-reply@${domain}>`,
	contact: process.env.contact || `contact@${domain}`,
	title: process.env.title || "BGS",
	inviteOnly: process.env.inviteOnly || false,
	minPasswordLength: process.env.minPasswordLength || 6,
	// Max games with status "open" a user may have created at once (they clog the
	// open-games lobby). Active/ended games don't count. 0 disables the cap.
	maxOpenGamesPerUser: Math.max(0, Number(process.env.maxOpenGamesPerUser) || 10),
	// Minimum interval between two auth emails (password reset, confirmation) sent
	// to the same address, so the site can't be used to flood someone's inbox (#195).
	authEmailCooldownMs: Math.max(0, Number(process.env.authEmailCooldownMs) || 15 * 60 * 1000),
	// Rate limiting of the public auth endpoints that reveal account existence
	// (login / forget / reset / confirm / signup — issue #195): per-IP fixed-window
	// attempt cap, in memory (per PM2 worker). Test overrides the whole bag (see
	// config/test-setup.ts): existing auth specs repeatedly hammer these endpoints
	// from 127.0.0.1 and would flake against a production-tight limit.
	authRateLimit: {
		windowMs: Number(process.env.authRateLimitWindowMs) || 60_000,
		maxPerIp: Number(process.env.authRateLimitMaxPerIp) || 10,
	},
	sessionSecret: process.env.sessionSecret || "Quel est donc le secret mystère du succès de Gaia Project?!",
	jwt: {
		keys: {
			private:
				process.env.jwtMode === "asymmetric"
					? fs.readFileSync(new URL("private.key", import.meta.url))
					: process.env.jwtSecret || "Secret du token JSON...",
			public:
				process.env.jwtMode === "asymmetric"
					? fs.readFileSync(new URL("public.pem", import.meta.url))
					: process.env.jwtSecret || "Secret du token JSON...",
		},
		algorithm: process.env.jwtMode === "asymmetric" ? "RS256" : ("HS256" as "RS256" | "HS256"),
	},
	listen: {
		port: {
			api: Number(process.env.port) || 50801,
			ws: Number(process.env.wsPort) || 50802,
			resources: Number(process.env.resourcesPort) || 50804,
		},
		// Bind explicitly to 127.0.0.1 so the address the upstream dials (127.0.0.1,
		// e.g. nginx in prod and the Vite proxy in dev) matches the one the server is
		// bound to. Otherwise on hosts where `localhost` resolves to ::1 first,
		// app.listen("localhost") binds only ::1 while clients dial 127.0.0.1 →
		// ECONNREFUSED. Operators can still force ::1 / 0.0.0.0 via `listenHost`.
		host: process.env.listenHost ?? "127.0.0.1",
	},
	database: {
		bgs: {
			url: process.env.dbUrl || "mongodb://localhost:27517/admin",
			name: dbName,
		},
		nodebb: process.env.nodebbDbUrl || "mongodb://nodebb:NodeBBPassword@localhost:27017/nodebb",
	},
	isProduction: process.env.NODE_ENV === "production",
	/** Is the computer able to send emails? If not, let the main server send the emails */
	automatedEmails: process.env.automatedEmails || false,
	lokiUrl: process.env.lokiUrl || "http://127.0.0.1:3100",
	// NodeBB forum — the admin serverinfo endpoint pings {forumUrl}/api/config to
	// report forum up/down on the dashboard.
	forumUrl: process.env.forumUrl || "https://forum.boardgamers.space",
	// Cron (game notifications, scheduled games, emails) is on by default — in dev the
	// single process must run it. PM2 workers opt out with cron=false so only the
	// dedicated api-cron process runs it (see ecosystem.config.cjs).
	cron: (process.env.cron ?? "true") !== "false",
	// Archiving of never-used, long-inactive user accounts ("delete" mode moves them to
	// the deletedUsers collection, from which they can be restored) is off by default.
	// Enable "dry-run" first to see what would be archived in the logs, then flip to
	// "delete" (see services/user.ts#cleanupDeadUsers).
	cleanupDeadUsers:
		process.env.cleanupDeadUsers === "dry-run" || process.env.cleanupDeadUsers === "delete"
			? process.env.cleanupDeadUsers
			: ("off" as "off" | "dry-run" | "delete"),
	cleanupDeadUsersMaxAgeDays: Number(process.env.cleanupDeadUsersMaxAgeDays) || 365,
	cleanupDeadUsersBatchSize: Number(process.env.cleanupDeadUsersBatchSize) || 50,
	// Auto-drop of inactive players in stalled async games / auto-cancel of games with
	// no active human left (#94). A "live/realtime" game (timePerGame ≤ this) never
	// drops anyone for inactivity (kicking a player mid-blitz is wrong); it can only
	// be cancelled outright, via autoCancelLiveIdleMs below.
	autoCancelLiveThresholdSec: Number(process.env.autoCancelLiveThresholdSec) || 24 * 3600,
	// A current player's deadline can pass + this grace before the sweep acts. Absorbs
	// the daily paused timer window (deadline() maps it to the next window's start, so
	// this is true overtime) and gives a short "still time to move" buffer beyond the
	// manual-drop bar (`POST /game/:id/drop/:userId`, deadline < now).
	autoCancelGraceMs: Number(process.env.autoCancelGraceMs) || 10 * 24 * 3600 * 1000,
	// A live game (timePerGame ≤ autoCancelLiveThresholdSec) with no move for this
	// long is abandoned, not stalling — it is cancelled outright (no drops).
	autoCancelLiveIdleMs: Number(process.env.autoCancelLiveIdleMs) || 10 * 24 * 3600 * 1000,
	// Absolute floor: never touch a game with a move this recent, whatever the clocks say.
	autoCancelMinIdleMs: Number(process.env.autoCancelMinIdleMs) || 7 * 24 * 3600 * 1000,
	// Game age below which nothing is cancelled outright — everyone gets a drop instead
	// (a young game "that never really got going" still Elo-resolves its drops).
	autoCancelMinAgeMs: Number(process.env.autoCancelMinAgeMs) || 14 * 24 * 3600 * 1000,
	mailing: {
		provider: "mailgun",
		api: {
			key: process.env.mailingApiKey || "mailgun api key here...",
			host: process.env.mailingHost || "api.eu.mailgun.net",
		},
		domain: {
			standard: process.env.emailDomain || `mg.${domain}`,
			newsletter: process.env.newsletterDomain || `newsletter.${domain}`,
		},
	},
	social: {
		discord: {
			id: process.env.discordId || "discord-oauth-id",
			secret: process.env.discordSecret || "discord-oauth-secret",
		},
		facebook: {
			id: process.env.facebookId || "facebook-oauth-id",
			secret: process.env.facebookSecret || "facebook-oauth-secret",
		},
		google: {
			id: process.env.googleId || "google-oauth-id",
			secret: process.env.googleSecret || "google-oauth-secret",
		},
		github: {
			id: process.env.githubId || "github-oauth-id",
			// PKCE public client (see passport.ts): no secret needed. `undefined` (not a
			// placeholder string) is the "no secret" signal — makeSocialStrategy omits it.
			secret: process.env.githubSecret || undefined,
		},
		// Hugging Face uses CIMD (Client ID Metadata Documents): the client_id is the
		// env's own `/.well-known/oauth-cimd` URL (served by the web app), computed at
		// request time in routes/account/auth.ts — no env/registration needed at all.
	},
	silent: false,
};
