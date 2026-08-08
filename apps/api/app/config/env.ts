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
	site: process.env.site || `www.${domain}`,
	noreply: process.env.noreply || `BGS <no-reply@${domain}>`,
	contact: process.env.contact || `contact@${domain}`,
	title: process.env.title || "BGS",
	inviteOnly: process.env.inviteOnly || false,
	minPasswordLength: process.env.minPasswordLength || 6,
	// Max games with status "open" a user may have created at once (they clog the
	// open-games lobby). Active/ended games don't count. 0 disables the cap.
	maxOpenGamesPerUser: Math.max(0, Number(process.env.maxOpenGamesPerUser) || 10),
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
		nodebb: "mongodb://nodebb:NodeBBPassword@localhost:27017/nodebb",
	},
	isProduction: process.env.NODE_ENV === "production",
	/** Is the computer able to send emails? If not, let the main server send the emails */
	automatedEmails: process.env.automatedEmails || false,
	lokiUrl: process.env.lokiUrl || "http://127.0.0.1:3100",
	// Cron (game notifications, scheduled games, emails) is on by default — in dev the
	// single process must run it. PM2 workers opt out with cron=false so only the
	// dedicated api-cron process runs it (see ecosystem.config.cjs).
	cron: (process.env.cron ?? "true") !== "false",
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
