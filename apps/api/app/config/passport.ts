import assert from "assert";
import createError from "http-errors";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
import type { Strategy } from "passport";
import { Strategy as DiscordStrategy } from "passport-discord";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import validator from "validator";
import type { UserDocument } from "../models";
import { DEFAULT_KARMA, MAX_EMAIL_LENGTH, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, UserUtils } from "../models";
import env from "./env";
import { z } from "zod";
import { User } from "@bgs/types";
import { ObjectId } from "mongodb";

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

        await newUser.sendConfirmationEmail();

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

        if (await User.findByUsername(username)) {
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
        const newUser = new User();

        newUser.account.username = username;
        newUser.security.slug = UserUtils.generateSlug(username);
        newUser.account.social[decoded.provider] = decoded.id;
        newUser.account.termsAndConditions = new Date();
        newUser.security.confirmed = true;

        // save the user
        await newUser.save();

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

        const user = await User.findByEmail(email);

        // check to see if theres already a user with that email
        if (!user) {
          throw createError(404, "No user with this email");
        }

        user.validateResetKey(req.body.resetKey);

        // set the user's local credentials
        await user.resetPassword(password);

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
        const user = await User.findByEmail(email);
        // if no user is found, return the message
        if (!user) {
          throw createError(404, `${email} isn't registered`);
        }

        // if the user is found but the password is wrong
        if (!(await user.validPassword(password))) {
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
          const currentUser: UserDocument = req.user;
          const existingUser = await User.findOne({ [`account.social.${provider}`]: profile.id });

          if (currentUser) {
            if (existingUser && existingUser._id === currentUser._id) {
              done(null, existingUser);
              return;
            }
            assert(!currentUser.account.social[provider], `You already have a ${provider} account connected`);
            assert(!existingUser, `Another user is already connected to that ${provider} account`);

            currentUser.account.social[provider] = profile.id;

            await currentUser.save();
            done(null, currentUser);
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
