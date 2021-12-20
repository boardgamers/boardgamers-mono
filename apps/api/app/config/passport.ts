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
import { User, UserDocument } from "../models";
import env from "./env";

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
        if (await User.findByEmail(email)) {
          throw createError(409, "Email is already taken");
        }

        const { username } = req.body;

        if (!username) {
          throw createError(422, "Specify a username");
        }

        if (await User.findByUsername(username)) {
          throw createError(422, `Username ${username} is taken`);
        }

        // if there is no user with that email
        // create the user
        const newUser = new User();

        // set the user's local credentials
        newUser.account.email = email;
        newUser.account.username = username;
        newUser.account.termsAndConditions = new Date();
        newUser.account.password = await newUser.generateHash(password);
        newUser.settings.mailing.newsletter = req.body.newsletter === true || req.body.newsletter === "true";
        newUser.generateConfirmKey();

        // save the user
        await newUser.save();

        if (!newUser.security.confirmed) {
          await newUser.sendConfirmationEmail();
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
