import { IAbstractUser } from "@lib/user";
import assert from "assert";
import bcrypt from "bcryptjs";
import { ObjectId } from "bson";
import crypto from "crypto";
import _ from "lodash";
import locks from "mongo-locks";
import mongoose from "mongoose";
import { env, sendmail } from "../config";
import { Game } from "./game";

const Schema = mongoose.Schema;

export const defaultKarma = 75;
export const maxKarma = 100;

export interface UserDocument extends IAbstractUser, mongoose.Document {
  isAdmin(): boolean;

  generateHash(password: string): Promise<string>;
  validPassword(password: string): Promise<boolean>;
  resetPassword(password: string): Promise<void>;
  email(): string;
  // Filtered user for public consumption
  publicInfo(): UserDocument;
  changeEmail(email: string): Promise<void>;
  generateResetLink(): Promise<void>;
  resetKey(): string;
  validateResetKey(key: string): void;
  generateConfirmKey(): void;
  confirmKey(): string;
  confirm(key: string): Promise<void>;
  recalculateKarma(since?: Date): Promise<void>;
  sendConfirmationEmail(): Promise<void>;
  sendResetEmail(): Promise<void>;
  sendMailChangeEmail(newEmail: string): Promise<void>;
  sendGameNotificationEmail(): Promise<void>;
  updateGameNotification(): Promise<void>;
  isSocialAccount(): boolean;
  notifyLogin(ip: string): Promise<void>;
  notifyLastIp(ip: string): Promise<void>;
}

interface UserModel extends mongoose.Model<UserDocument> {
  findByEmail(email: string): Promise<UserDocument>;
  findByUsername(name: string): Promise<UserDocument>;
  findByUrl(urlComponent: string): Promise<UserDocument>;
}

// define the schema for our user model
const schema = new Schema<UserDocument, UserModel>(
  {
    account: {
      username: {
        type: String,
        maxlength: [20, "Pick a shorter username"],
        minlength: [2, "Pick a longer username"],
        trim: true,
        unique: true,
        sparse: true,
      },
      email: {
        type: String,
        unique: true,
        maxlength: [50, "Too long email"],
        trim: true,
        lowercase: true,
        sparse: true,
      },
      password: String,
      karma: {
        type: Number,
        default: defaultKarma,
        max: maxKarma,
      },
      termsAndConditions: Date,
      social: {
        google: {
          type: String,
          sparse: true,
          unique: true,
        },
        facebook: {
          type: String,
          sparse: true,
          unique: true,
        },
        discord: {
          type: String,
          sparse: true,
          unique: true,
        },
      },
    },
    settings: {
      mailing: {
        newsletter: Boolean,
        game: {
          delay: Number,
          activated: Boolean,
        },
      },
      game: {
        soundNotification: Boolean,
      },
      home: {
        showMyGames: {
          type: Boolean,
          default: true,
        },
      },
    },
    security: {
      lastIp: { type: String, index: true },
      lastActive: Date,
      lastOnline: Date,
      lastLogin: {
        ip: String,
        date: Date,
      },
      confirmed: Boolean,
      confirmKey: String,
      reset: {
        key: String,
        issued: Date,
      },
      slug: {
        type: String,
        sparse: true,
        unique: true,
        trim: true,
        lowercase: true,
      },
    },
    meta: {
      nextGameNotification: Date,
      lastGameNotification: Date,
    },
    authority: String,
  },
  {
    toJSON: {
      transform: (doc, ret) => {
        delete ret.account.password;
        delete ret.security.confirmKey;
        delete (ret.security.reset || {}).key;
        return ret;
      },
    },
    timestamps: true,
  }
);

// methods ======================
// generating a hash
schema.method("generateHash", function (this: UserDocument, password: string) {
  return bcrypt.hash(password, 8);
});

// checking if password is valid
schema.method("validPassword", function (this: UserDocument, password: string) {
  return bcrypt.compare(password, this.account.password);
});

schema.method("resetPassword", function (this: UserDocument, password: string) {
  return this.generateHash(password).then((hash: string) => {
    return this.update({
      "account.password": hash,
      "security.reset": null,
    });
  });
});

schema.method("email", function (this: UserDocument) {
  return this.account.email;
});

schema.method("changeEmail", async function (this: UserDocument, email: string) {
  assert(!this.isSocialAccount(), "You can't change the email of a social account.");

  assert(!(await User.findByEmail(email)), "User with this email already exists.");

  this.account.email = email;
  this.security.confirmed = false;
  this.security.confirmKey = crypto.randomBytes(12).toString("base64");

  await this.update({
    "account.email": email,
    "security.confirmed": false,
    "security.confirmKey": this.security.confirmKey,
  });
});

schema.method("publicInfo", function (this: UserDocument) {
  return _.pick(this, ["_id", "account.username", "account.karma", "createdAt"]);
});

schema.method("generateResetLink", async function (this: UserDocument) {
  this.security.reset = {
    key: crypto.randomBytes(12).toString("base64"),
    issued: new Date(),
  };

  await this.update({ "security.reset": this.security.reset });
});

schema.method("resetKey", function (this: UserDocument) {
  return this.security.reset.key;
});

schema.method("validateResetKey", function (this: UserDocument, key: string) {
  if (!this.security.reset || !this.security.reset.key) {
    throw new Error("This user didn't ask for a password reset.");
  }
  if (this.security.reset.key !== key) {
    throw new Error("The reset password link is wrong.");
  }
  const resetIssued = new Date(this.security.reset.issued);
  if (Date.now() - resetIssued.getTime() > 24 * 3600 * 1000) {
    throw new Error("The reset link has expired.");
  }
});

schema.method("generateConfirmKey", function (this: UserDocument) {
  this.security.confirmKey = crypto.randomBytes(12).toString("base64");
});

schema.method("confirmKey", function (this: UserDocument) {
  return this.security.confirmKey;
});

schema.method("confirm", function (this: UserDocument, key: string) {
  assert(!this.security.confirmed, "You already are confirmed");
  assert(key && this.confirmKey() === key, `Wrong confirm link.`);
  this.security.confirmed = true;
  this.security.confirmKey = null;

  return this.update({
    "security.confirmed": true,
    "security.confirmKey": null,
  }).exec();
});

schema.method("sendConfirmationEmail", function (this: UserDocument) {
  return sendmail({
    from: env.noreply,
    to: this.email(),
    subject: "Confirm your account",
    html: `
    <p>Hello, we're delighted to have a new Gaia Project player among us!</p>
    <p>To finish your registration and confirm your account with us at ${env.site},
     click <a href='http://${env.site}/confirm?key=${encodeURIComponent(this.confirmKey())}&email=${encodeURIComponent(
      this.email()
    )}'>here</a>.</p>

    <p>If you didn't create an account with us, ignore this email.</p>`,
  });
});

schema.method("sendMailChangeEmail", function (this: UserDocument, newEmail: string) {
  if (!this.email()) {
    return;
  }

  return sendmail({
    from: env.noreply,
    to: this.email(),
    subject: "Mail change",
    html: `
    <p>Hello ${this.account.username},</p>
    <p>We're here to send you confirmation of your email change to ${escape(newEmail)}!</p>
    <p>If you didn't change your email, please contact us ASAP at ${env.contact}.</p>`,
  });
});

schema.method("sendResetEmail", function (this: UserDocument) {
  return sendmail({
    from: env.noreply,
    to: this.email(),
    subject: "Forgotten password",
    html: `
    <p>A password reset was asked for your account,
    click <a href='http://${env.site}/reset?key=${encodeURIComponent(this.resetKey())}&email=${encodeURIComponent(
      this.email()
    )}'>here</a> to reset your password.</p>

    <p>If this didn't come from you, ignore this email.</p>`,
  });
});

schema.method("sendGameNotificationEmail", async function (this: UserDocument) {
  const free = await locks.lock("game-notification", this.id);
  try {
    // Inside the lock, reload the user
    const user = await User.findById(this.id);

    if (!user.settings.mailing.game.activated) {
      user.meta.nextGameNotification = undefined;
      await user.save();
      return;
    }

    if (!user.meta.nextGameNotification) {
      return;
    }

    if (user.meta.nextGameNotification > new Date()) {
      return;
    }

    /* check if timer already started was present at the time of the last notification for at least one game*/
    const count = await Game.count({
      currentPlayers: { $elemMatch: { _id: user._id, timerStart: { $lt: user.meta.lastGameNotification } } },
      status: "active",
    }).limit(1);

    if (count > 0) {
      return;
    }

    const activeGames = await Game.findWithPlayersTurn(user.id).select("-data").lean(true);

    if (activeGames.length === 0) {
      user.meta.nextGameNotification = undefined;
      await user.save();
      return;
    }

    /* Check the oldest game where it's your turn */
    let lastMove: Date = new Date();
    for (const game of activeGames) {
      const timerStart = game.currentPlayers.find((pl) => pl._id.equals(this.id))?.timerStart;
      if (timerStart && timerStart < lastMove) {
        lastMove = timerStart;
      }
    }

    /* Test if we're sending the notification too early */
    const notificationDate = new Date(lastMove.getTime() + (user.settings.mailing.game.delay || 30 * 60) * 1000);

    if (notificationDate > new Date()) {
      user.meta.nextGameNotification = notificationDate;
      await user.save();
      return;
    }

    const gameString = activeGames.length > 1 ? `${activeGames.length} games` : "one game";

    // Send email
    if (this.email() && this.security.confirmed) {
      sendmail({
        from: env.noreply,
        to: this.email(),
        subject: `Your turn`,
        html: `
        <p>Hello ${this.account.username}</p>

        <p>It's your turn on ${gameString},
        click <a href='http://${env.site}/user/${encodeURIComponent(
          this.account.username
        )}'>here</a> to see your active games.</p>

        <p>You can also change your email settings and unsubscribe <a href='http://${
          env.site
        }/account'>here</a> with a simple click.</p>`,
      }).catch(console.error);
    }

    user.meta.nextGameNotification = undefined;
    user.meta.lastGameNotification = new Date(Date.now());

    await user.save();
  } catch (err) {
    console.error(err);
  } finally {
    free();
  }
});

schema.method("updateGameNotification", async function (this: UserDocument) {
  if (!this.settings.mailing.game.activated) {
    return;
  }
  const date = new Date(Date.now() + (this.settings.mailing.game.delay || 30 * 60) * 1000);
  if (!this.meta.nextGameNotification || this.meta.nextGameNotification > date) {
    this.meta.nextGameNotification = date;
    await this.save();
  }
});

schema.method("isSocialAccount", function (this: UserDocument) {
  return false;
});

schema.method("notifyLogin", function (this: UserDocument, ip: string) {
  return this.update({
    "security.lastLogin.date": Date.now(),
    "security.lastLogin.ip": ip,
    "security.lastIp": ip,
  });
});

schema.method("notifyLastIp", async function (this: UserDocument, ip: string) {
  const update: { "security.lastIp"?: string; "security.lastActive"?: Date } = {};
  if (this.security.lastIp !== ip) {
    this.security.lastIp = ip;
    update["security.lastIp"] = ip;
  }
  if (!this.security.lastActive || Date.now() - this.security.lastActive.getTime() > 60 * 1000) {
    this.security.lastActive = new Date();
    update["security.lastActive"] = new Date();
  }
  if (!_.isEmpty(update)) {
    await this.update(update);
  }
});

schema.method("isAdmin", function (this: UserDocument) {
  return this.authority === "admin";
});

schema.static("findByUrl", function (this: UserModel, urlComponent: string) {
  return this.findById(new ObjectId(urlComponent));
});

schema.static("findByUsername", function (this: UserModel, username: string) {
  return this.findOne({ "security.slug": username.toLowerCase().replace(/\s+/, "-") });
});

schema.static("findByEmail", function (this: UserModel, email: string) {
  return this.findOne({ "account.email": email.toLowerCase().trim() });
});

schema.method("recalculateKarma", async function (this: UserDocument, since = new Date(0)) {
  const games = await Game.find({ "players._id": this._id, lastMove: { $gte: since } }, "status cancelled players", {
    lean: true,
  }).sort("lastMove");

  let karma = defaultKarma;

  for (const game of games) {
    if (game.players.find((player) => player._id.equals(this._id)).dropped) {
      karma -= 10;
    } else if (!game.cancelled && game.status === "ended") {
      karma = Math.min(karma + 1, maxKarma);
    }
  }

  this.account.karma = karma;
});

schema.pre("save", function (this: UserDocument) {
  if (!this.security.slug && this.account.username) {
    this.security.slug = this.account.username.toLowerCase().trim().replace(/\s+/g, "-");
  }
});

const User = mongoose.model("User", schema);
export { User };
