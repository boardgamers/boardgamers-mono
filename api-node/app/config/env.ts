import os from "os";
import fs from "fs";
import path from "path";

const domain = process.env.domain || "boardgamers.space";

export default {
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
          ? fs.readFileSync(path.join(__dirname, "private.key"))
          : process.env.jwtSecret || "Secret du token JSON...",
      public:
        process.env.jwtMode === "asymmetric"
          ? fs.readFileSync(path.join(__dirname, "public.pem"))
          : process.env.jwtSecret || "Secret du token JSON...",
    },
    algorithm: process.env.jwtMode === "asymmetric" ? "RS256" : ("HS256" as "RS256" | "HS256"),
  },
  listen: {
    port: {
      api: +process.env.port || 50801,
      ws: +process.env.wsPort || 50802,
      resources: +process.env.resourcesPort || 50804,
    },
    host: process.env.listenHost ?? "localhost",
  },
  dbUrl: process.env.dbUrl || "mongodb://localhost:27017/admin",
  nodebb: "mongodb://nodebb:NodeBBPassword@localhost:27017/nodebb",
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
