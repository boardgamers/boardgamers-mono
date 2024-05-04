import assert from "assert";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
import type { Profile, Strategy } from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import type { StrategyOptionWithRequest } from "passport-facebook";
import { Strategy as FacebookStrategy } from "passport-facebook";
import type { VerifyCallback } from "passport-google-oauth20";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import validator from "validator";
import { DEFAULT_KARMA, MAX_EMAIL_LENGTH, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, UserUtils } from "../models";
import env from "./env";
import { z } from "zod";
import type { SocialProvider } from "@bgs/types";
import type { User } from "@bgs/types";
import { ObjectId } from "mongodb";
import { differenceInHours } from "date-fns";
import { collections } from "./db";

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
        if (!validator.isEmail(email)) {
          throw createError(422, "Wrong email format");
        }

        if (password.length < env.minPasswordLength) {
          throw createError(422, "Password is too short");
        }

        if (!req.body.termsAndConditions) {
          throw createError(422, "You need to read and agree to the terms and conditions");
        }

        // check to see if there's already a user with that email
        if (await UserUtils.findByEmail(email)) {
          throw createError(409, "Email is already taken");
        }

        const { username } = z
          .object({
            username: z.string().min(MIN_USERNAME_LENGTH).max(MAX_USERNAME_LENGTH).trim(),
          })
          .parse(req.body);

        if (await UserUtils.findByUsername(username)) {
          throw createError(422, `Username ${username} is taken`);
        }

        email = z.string().email().toLowerCase().trim().max(MAX_EMAIL_LENGTH).parse(email);

        // if there is no user with that email
        // create the user
        const newUser: User<ObjectId> = {
          _id: new ObjectId(),
          account: {
            email,
            username,
            termsAndConditions: new Date(),
            password: await UserUtils.generateHash(password),
            avatar: "pixel-art",
            karma: DEFAULT_KARMA,
            bio: "",
            social: {},
          },
          security: {
            slug: UserUtils.generateSlug(username),
            confirmed: false,
            confirmKey: UserUtils.generateConfirmKey(),
            lastActive: new Date(),
            lastOnline: new Date(),
            lastLogin: {
              date: new Date(),
              ip: req.ip,
            },
            lastIp: req.ip,
          },
          settings: {
            mailing: {
              newsletter: req.body.newsletter === true || req.body.newsletter === "true",
              game: {
                delay: 0,
                activated: false,
              },
            },
            game: {
              soundNotification: false,
            },
            home: {
              showMyGames: true,
            },
          },
          meta: {},

          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await collections.users.insertOne(newUser);

        await UserUtils.sendConfirmationEmail(newUser);

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
    async (req, username, _password, done) => {
      try {
        const { jwt: token } = req.body;

        if (!req.body.termsAndConditions) {
          throw createError(422, "You need to read and agree to the terms and conditions");
        }

        username = z.string().min(MIN_USERNAME_LENGTH).max(MAX_USERNAME_LENGTH).trim().parse(username);

        if (await UserUtils.findByUsername(username)) {
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
        const newUser: User<ObjectId> = {
          _id: new ObjectId(),
          account: {
            username,
            termsAndConditions: new Date(),
            avatar: "pixel-art",
            karma: DEFAULT_KARMA,
            bio: "",
            social: {
              [decoded.provider]: decoded.id,
            },
          },
          security: {
            slug: UserUtils.generateSlug(username),
            confirmed: true,
            lastActive: new Date(),
            lastOnline: new Date(),
            lastLogin: {
              date: new Date(),
              ip: req.ip,
            },
            lastIp: req.ip,
          },
          settings: {
            mailing: {
              newsletter: req.body.newsletter === true || req.body.newsletter === "true",
              game: {
                delay: 0,
                activated: false,
              },
            },
            game: {
              soundNotification: false,
            },
            home: {
              showMyGames: true,
            },
          },
          meta: {},

          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await collections.users.insertOne(newUser);

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

        if (password.length < env.minPasswordLength) {
          throw createError(422, "Password too short");
        }

        const user = await UserUtils.findByEmail(email);

        // check to see if theres already a user with that email
        if (!user) {
          throw createError(404, "No user with this email");
        }

        const passedKey = z.object({ resetKey: z.string() }).parse(req.body).resetKey;

        if (!user.security.reset?.key) {
          throw new Error("This user didn't ask for a password reset.");
        }
        if (user.security.reset.key !== passedKey) {
          throw new Error("The reset password link is wrong.");
        }
        const resetIssued = new Date(user.security.reset.issued);
        if (differenceInHours(new Date(), resetIssued) > 24) {
          throw new Error("The reset link has expired.");
        }

        // set the user's local credentials
        await UserUtils.resetPassword(user._id, password);

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
        const user = await UserUtils.findByEmail(email);
        // if no user is found, return the message
        if (!user) {
          throw createError(404, `${email} isn't registered`);
        }

        if (!user.account.password) {
          throw createError(401, "You need to login with your social account or reset your password");
        }

        // if the user is found but the password is wrong
        if (!(await UserUtils.validPassword(password, user.account.password))) {
          throw createError(401, "Oops! Wrong password");
        }
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

function makeSocialStrategy<T extends Strategy>(
  provider: SocialProvider,
  SocialStrategy: new (
    arg1: StrategyOptionWithRequest,
    arg2: (
      req: Express.Request,
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => void
  ) => T
) {
  passport.use(
    provider,
    new SocialStrategy(
      {
        clientID: env.social[provider].id,
        clientSecret: env.social[provider].secret,
        passReqToCallback: true,
        callbackURL: `https://${env.site}/auth/${provider}/callback`,
      },
      async function (req, _token, _tokenSecret, profile, done) {
        try {
          const currentUser = req.user as User<ObjectId> | undefined;
          const existingUser = await collections.users.findOne({ [`account.social.${provider}`]: profile.id });

          if (currentUser) {
            if (existingUser && existingUser._id.equals(currentUser._id)) {
              done(undefined, existingUser);
              return;
            }
            assert(!currentUser.account.social[provider], `You already have a ${provider} account connected`);
            assert(!existingUser, `Another user is already connected to that ${provider} account`);

            currentUser.account.social[provider] = profile.id;
            await collections.users.updateOne(
              { _id: currentUser._id },
              { $set: { [`account.social.${provider}`]: profile.id }, updatedAt: new Date() }
            );

            done(undefined, currentUser);
          } else {
            if (existingUser) {
              done(undefined, existingUser);
            } else {
              // Create a new account
              done(undefined, { createSocialAccount: true, provider, id: profile.id });
            }
          }
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

// @ts-expect-error can't fix them all
makeSocialStrategy("discord", DiscordStrategy);
makeSocialStrategy("google", GoogleStrategy);
makeSocialStrategy("facebook", FacebookStrategy);
