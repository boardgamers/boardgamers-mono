import fs from "node:fs";
import os from "node:os";
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
      url: process.env.dbUrl || "mongodb://localhost:27017/admin",
      name: dbName,
    },
    nodebb: "mongodb://nodebb:NodeBBPassword@localhost:27017/nodebb",
  },
  isProduction: process.env.NODE_ENV === "production",
  threads: process.env.threads || os.cpus().length,
  /** Is the computer able to send emails? If not, let the main server send the emails */
  automatedEmails: process.env.automatedEmails || false,
  cron: process.env.chron || process.env.cron || false,
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
  },
  silent: false,
};
