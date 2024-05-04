import type { User } from "@bgs/types";
import assert from "assert";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Db, Collection } from "mongodb";
import { ObjectId } from "mongodb";
import { isEmpty, pick } from "lodash";
import { env, sendmail } from "../config";
import type { JsonObject, PickDeep } from "type-fest";
import { collections } from "../config/db";

export const DEFAULT_KARMA = 75;
export const MAX_KARMA = 100;
export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 20;
export const MAX_BIO_LENGTH = 500;
export const MAX_EMAIL_LENGTH = 50;

const secureId = () => crypto.randomBytes(12).toString("base64").replace(/\+/g, "_").replace(/\//g, "-");

export namespace UserUtils {
  export function isAdmin(authority: User["authority"]): authority is "admin" {
    return authority === "admin";
  }
  export function generateHash(password: string): Promise<string> {
    return bcrypt.hash(password, 8);
  }
  export function generateConfirmKey(): string {
    return secureId();
  }

  export function validPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  export async function resetPassword(_id: User<ObjectId>["_id"], password: string): Promise<void> {
    const hash = await generateHash(password);
    await collections.users.updateOne(
      { _id },
      { $set: { "account.password": hash, updatedAt: new Date() }, $unset: { "security.reset": "" } }
    );
  }

  export const publicFields = Object.freeze([
    "_id",
    "account.username",
    "account.bio",
    "account.karma",
    "createdAt",
  ] as const);

  export const publicProjection = Object.fromEntries(publicFields.map((field) => [field, 1]));

  export type PublicUser = PickDeep<User, (typeof publicFields)[number]>;

  export function publicInfo(user: User): PublicUser {
    return pick(user, publicFields) as PublicUser;
  }

  export function generateSlug(username: string): string {
    return username.toLowerCase().replace(/\s+/, "-");
  }

  export async function findByUsername(username: string): Promise<User<ObjectId> | null> {
    return collections.users.findOne({ "security.slug": generateSlug(username) });
  }

  export async function findByEmail(email: string): Promise<User<ObjectId> | null> {
    return collections.users.findOne({ "account.email": email.toLowerCase().trim() });
  }

  export async function findByUrl(urlComponent: string): Promise<User<ObjectId> | null> {
    return collections.users.findOne({ _id: new ObjectId(urlComponent) });
  }

  export function sanitize(user: User<ObjectId>): JsonObject {
    const json = JSON.parse(JSON.stringify(user));
    delete json.account.password;
    delete json.security.confirmKey;
    if (json.reset) {
      delete json.reset.key;
    }

    return json;
  }

  export async function sendConfirmationEmail(user: User<ObjectId>): Promise<void> {
    if (user.account.email && !user.security.confirmed && user.security.confirmKey) {
      await sendmail({
        from: env.noreply,
        to: user.account.email,
        subject: "Confirm your account",
        html: `
        <p>Hello, we're delighted to have a new Gaia Project player among us!</p>
        <p>To finish your registration and confirm your account with us at ${env.site},
         click <a href='https://${env.site}/confirm?key=${encodeURIComponent(
           user.security.confirmKey
         )}&email=${encodeURIComponent(user.account.email)}'>here</a>.</p>
  
        <p>If you didn't create an account with us, ignore this email.</p>`,
      });
    } else {
      throw new Error("User is already confirmed.");
    }
  }
}

export async function createUserCollection(db: Db): Promise<Collection<User<ObjectId>>> {
  const collection = db.collection<User<ObjectId>>("users");

  await collection.createIndex({ "account.username": 1 }, { unique: true });
  await collection.createIndex({ "security.slug": 1 }, { unique: true });
  await collection.createIndex({ "security.lastIp": 1 });
  await collection.createIndex({ "account.email": 1 }, { unique: true, sparse: true });

  await collection.createIndex({ "social.facebook": 1 }, { unique: true, sparse: true });
  await collection.createIndex({ "social.google": 1 }, { unique: true, sparse: true });
  await collection.createIndex({ "social.discord": 1 }, { unique: true, sparse: true });

  return collection;
}

export interface UserDocument extends User<ObjectId> {
  resetKey(): string;
  generateConfirmKey(): void;
  confirm(key: string): Promise<void>;
  recalculateKarma(since?: Date): Promise<void>;
  sendConfirmationEmail(): Promise<void>;
  sendMailChangeEmail(newEmail: string): Promise<void>;
  sendGameNotificationEmail(): Promise<void>;
  updateGameNotification(): Promise<void>;
}

schema.method("sendMailChangeEmail", function (this: UserDocument, newEmail: string) {
  if (!this.email()) {
    return Promise.resolve();
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
        click <a href='https://${env.site}/user/${encodeURIComponent(
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
    free().catch(console.error);
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

schema.method("recalculateKarma", async function (this: UserDocument, since = new Date(0)) {
  const games = await Game.find({ "players._id": this._id, lastMove: { $gte: since } }, "status cancelled players", {
    lean: true,
  }).sort("lastMove");

  let karma = DEFAULT_KARMA;

  for (const game of games) {
    if (game.players.find((player) => player._id.equals(this._id)).dropped) {
      karma -= 10;
    } else if (!game.cancelled && game.status === "ended") {
      karma = Math.min(karma + 1, MAX_KARMA);
    }
  }

  this.account.karma = karma;
});
