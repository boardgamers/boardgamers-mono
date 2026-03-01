import assert from "assert";
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
import {
  findByEmail,
  findByUsername,
  generateConfirmKey,
  generateHash,
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

        if (await findByUsername(username)) {
          throw createError(422, `Username ${username} is taken`);
        }

        // if there is no user with that email
        // create the user
        const slug = username.toLowerCase().replace(/\s+/g, "-");
        const confirmKey = generateConfirmKey();
        const newUserDoc: UserDoc = {
          account: {
            email: email.toLowerCase().trim(),
            username,
            password: await generateHash(password),
            karma: 75,
            termsAndConditions: new Date(),
            social: { google: "", facebook: "", discord: "" },
            avatar: "avataaars",
            bio: "",
          },
          settings: {
            mailing: {
              newsletter: req.body.newsletter === true || req.body.newsletter === "true",
              game: { delay: 30 * 60, activated: true },
            },
            game: { soundNotification: true },
            home: { showMyGames: false },
          },
          security: {
            lastIp: "",
            lastLogin: { ip: "", date: new Date(0) },
            lastActive: new Date(0),
            lastOnline: new Date(0),
            confirmed: false,
            confirmKey,
            reset: { key: "", issued: new Date(0) },
            slug,
          },
          meta: { nextGameNotification: new Date(0), lastGameNotification: new Date(0) },
          authority: "user",
        };

        const result = await colls.users.insertOne(newUserDoc);
        const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };

        if (!newUser.security.confirmed) {
          await sendConfirmationEmail(newUser);
        }

        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  )
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
        const { jwt: token } = req.body;

        if (!req.body.termsAndConditions) {
          throw createError(422, "You need to read and agree to the terms and conditions");
        }

        if (!username) {
          throw createError(422, "Specify a username");
        }

        if (await findByUsername(username)) {
          throw createError(422, `Username ${username} is taken`);
        }

        const decoded = jwt.verify(token, env.jwt.keys.public) as {
          id: string;
          provider: string;
          createSocialAccount: true;
        };

        assert(decoded.createSocialAccount, "Malformed JWT payload");
        assert(["google", "facebook", "discord"].includes(decoded.provider), "Uknown social provider");

        // create the user
        const slug = username.toLowerCase().replace(/\s+/g, "-");
        const social = { google: "", facebook: "", discord: "" };
        social[decoded.provider as keyof typeof social] = decoded.id;
        const newUserDoc: UserDoc = {
          account: {
            email: "",
            username,
            password: "",
            karma: 75,
            termsAndConditions: new Date(),
            social,
            avatar: "avataaars",
            bio: "",
          },
          settings: {
            mailing: { newsletter: false, game: { delay: 30 * 60, activated: true } },
            game: { soundNotification: true },
            home: { showMyGames: false },
          },
          security: {
            lastIp: "",
            lastLogin: { ip: "", date: new Date(0) },
            lastActive: new Date(0),
            lastOnline: new Date(0),
            confirmed: true,
            confirmKey: "",
            reset: { key: "", issued: new Date(0) },
            slug,
          },
          meta: { nextGameNotification: new Date(0), lastGameNotification: new Date(0) },
          authority: "user",
        };

        const result = await colls.users.insertOne(newUserDoc);
        const newUser: WithId<UserDoc> = { ...newUserDoc, _id: result.insertedId };

        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  )
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
    }
  )
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
        const user = await findByEmail(email);
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
    }
  )
);

function makeSocialStrategy<T extends Strategy>(provider: string, SocialStrategy: new (...args: unknown[]) => T) {
  passport.use(
    provider,
    new SocialStrategy(
      {
        clientID: env.social[provider].id,
        clientSecret: env.social[provider].secret,
        passReqToCallback: true,
        callbackURL: `https://${env.site}/auth/${provider}/callback`,
      },
      async function (req, token, tokenSecret, profile, done) {
        try {
          const currentUser: WithId<UserDoc> = req.user;
          const existingUser = await colls.users.findOne({ [`account.social.${provider}`]: profile.id });

          if (currentUser) {
            if (existingUser && existingUser._id.equals(currentUser._id)) {
              done(null, existingUser);
              return;
            }
            assert(!currentUser.account.social[provider], `You already have a ${provider} account connected`);
            assert(!existingUser, `Another user is already connected to that ${provider} account`);

            await colls.users.updateOne(
              { _id: currentUser._id },
              { $set: { [`account.social.${provider}`]: profile.id } }
            );
            const updatedUser = await colls.users.findOne({ _id: currentUser._id });
            done(null, updatedUser!);
          } else {
            if (existingUser) {
              done(null, existingUser);
            } else {
              // Create a new account
              done(null, { createSocialAccount: true, provider, id: profile.id });
            }
          }
        } catch (err) {
          done(err);
        }
      }
    )
  );
}

makeSocialStrategy("discord", DiscordStrategy);
makeSocialStrategy("google", GoogleStrategy);
makeSocialStrategy("facebook", FacebookStrategy);
