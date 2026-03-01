import type { UserDoc } from "@bgs/models";
import assert from "node:assert";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { WithId } from "mongodb";
import locks from "../config/locks.ts";
import { colls } from "../config/db.ts";
import { env, sendmail } from "../config/index.ts";
import { findGamesWithPlayersTurn } from "./game.ts";

export const defaultKarma = 75;
export const maxKarma = 100;

const secureId = () => crypto.randomBytes(12).toString("base64").replace(/\+/g, "_").replace(/\//g, "-");

export const publicInfoProjection = {
  _id: 1,
  "account.username": 1,
  "account.bio": 1,
  "account.karma": 1,
  createdAt: 1,
} as const;

export async function findByEmail(email: string) {
  return colls.users.findOne({ "account.email": email.toLowerCase().trim() });
}

export async function findByUsername(name: string) {
  return colls.users.findOne({ "security.slug": name.toLowerCase().replace(/\s+/g, "-") });
}

export async function findByUrl(urlComponent: string) {
  const { ObjectId } = await import("mongodb");
  return colls.users.findOne({ _id: new ObjectId(urlComponent) });
}

export function isAdmin(user: WithId<UserDoc>) {
  return user.authority === "admin";
}

export async function generateHash(password: string) {
  return bcrypt.hash(password, 8);
}

export async function validPassword(user: WithId<UserDoc>, password: string) {
  return bcrypt.compare(password, user.account.password!);
}

export async function resetPassword(user: WithId<UserDoc>, password: string) {
  const hash = await generateHash(password);
  await colls.users.updateOne({ _id: user._id }, { $set: { "account.password": hash, "security.reset": null } });
}

export function generateConfirmKey(): string {
  return secureId();
}

export function validateResetKey(user: WithId<UserDoc>, key: string) {
  if (!user.security.reset || !user.security.reset.key) {
    throw new Error("This user didn't ask for a password reset.");
  }
  if (user.security.reset.key !== key) {
    throw new Error("The reset password link is wrong.");
  }
  const resetIssued = new Date(user.security.reset.issued);
  if (Date.now() - resetIssued.getTime() > 24 * 3600 * 1000) {
    throw new Error("The reset link has expired.");
  }
}

export async function confirm(user: WithId<UserDoc>, key: string) {
  assert(key && user.security.confirmKey === key, "Wrong confirm link.");
  await colls.users.updateOne({ _id: user._id }, { $set: { "security.confirmed": true, "security.confirmKey": null } });
}

export async function generateResetLink(user: WithId<UserDoc>) {
  const reset = { key: secureId(), issued: new Date() };
  await colls.users.updateOne({ _id: user._id }, { $set: { "security.reset": reset } });
  user.security.reset = reset;
}

export async function recalculateKarma(user: WithId<UserDoc>, since = new Date(0)) {
  const playerGames = await colls.games
    .find(
      { "players._id": user._id, lastMove: { $gte: since } },
      { projection: { status: 1, cancelled: 1, players: 1 }, sort: { lastMove: 1 } }
    )
    .toArray();

  let karma = defaultKarma;

  for (const game of playerGames) {
    if (game.players.find((player) => player._id.equals(user._id))?.dropped) {
      karma -= 10;
    } else if (!game.cancelled && game.status === "ended") {
      karma = Math.min(karma + 1, maxKarma);
    }
  }

  user.account.karma = karma;
  await colls.users.updateOne({ _id: user._id }, { $set: { "account.karma": karma } });
}

export async function notifyLogin(user: WithId<UserDoc>, ip: string) {
  await colls.users.updateOne(
    { _id: user._id },
    { $set: { "security.lastLogin.date": new Date(), "security.lastLogin.ip": ip, "security.lastIp": ip } }
  );
}

export async function notifyLastIp(user: WithId<UserDoc>, ip: string) {
  const update: Record<string, unknown> = {};
  if (user.security.lastIp !== ip) {
    update["security.lastIp"] = ip;
  }
  if (!user.security.lastActive || Date.now() - new Date(user.security.lastActive).getTime() > 60 * 1000) {
    update["security.lastActive"] = new Date();
  }
  if (Object.keys(update).length > 0) {
    await colls.users.updateOne({ _id: user._id }, { $set: update });
  }
}

export function sendConfirmationEmail(user: WithId<UserDoc>) {
  return sendmail({
    from: env.noreply,
    to: user.account.email!,
    subject: "Confirm your account",
    html: `
    <p>Hello, we're delighted to have a new Gaia Project player among us!</p>
    <p>To finish your registration and confirm your account with us at ${env.site},
     click <a href='http://${env.site}/confirm?key=${encodeURIComponent(user.security.confirmKey!)}&email=${encodeURIComponent(user.account.email!)}'>here</a>.</p>

    <p>If you didn't create an account with us, ignore this email.</p>`,
  });
}

export function sendResetEmail(user: WithId<UserDoc>) {
  return sendmail({
    from: env.noreply,
    to: user.account.email!,
    subject: "Forgotten password",
    html: `
    <p>A password reset was asked for your account,
    click <a href='http://${env.site}/reset?key=${encodeURIComponent(user.security.reset!.key!)}&email=${encodeURIComponent(user.account.email!)}'>here</a> to reset your password.</p>

    <p>If this didn't come from you, ignore this email.</p>`,
  });
}

export function sendMailChangeEmail(user: WithId<UserDoc>, newEmail: string) {
  if (!user.account.email) {
    return Promise.resolve();
  }

  return sendmail({
    from: env.noreply,
    to: user.account.email,
    subject: "Mail change",
    html: `
    <p>Hello ${user.account.username},</p>
    <p>We're here to send you confirmation of your email change to ${escape(newEmail)}!</p>
    <p>If you didn't change your email, please contact us ASAP at ${env.contact}.</p>`,
  });
}

export async function sendGameNotificationEmail(user: WithId<UserDoc>) {
  await using _lock = await locks.lock("game-notification", user._id.toString());
  try {
    const freshUser = await colls.users.findOne({ _id: user._id });
    if (!freshUser) {
      return;
    }

    if (!freshUser.settings?.mailing?.game?.activated) {
      await colls.users.updateOne({ _id: user._id }, { $unset: { "meta.nextGameNotification": "" } });
      return;
    }

    if (!freshUser.meta?.nextGameNotification || freshUser.meta.nextGameNotification > new Date()) {
      return;
    }

    const count = await colls.games.countDocuments({
      currentPlayers: { $elemMatch: { _id: user._id, timerStart: { $lt: freshUser.meta.lastGameNotification } } },
      status: "active",
    });

    if (count > 0) {
      return;
    }

    const activeGames = await findGamesWithPlayersTurn(user._id)
      .project({ data: 0 })
      .toArray();

    if (activeGames.length === 0) {
      await colls.users.updateOne({ _id: user._id }, { $unset: { "meta.nextGameNotification": "" } });
      return;
    }

    let lastMove = new Date();
    for (const game of activeGames) {
      const timerStart = game.currentPlayers?.find((pl) => pl._id.equals(user._id))?.timerStart;
      if (timerStart && timerStart < lastMove) {
        lastMove = timerStart;
      }
    }

    const notificationDate = new Date(
      lastMove.getTime() + (freshUser.settings.mailing.game.delay || 30 * 60) * 1000
    );

    if (notificationDate > new Date()) {
      await colls.users.updateOne({ _id: user._id }, { $set: { "meta.nextGameNotification": notificationDate } });
      return;
    }

    const gameString = activeGames.length > 1 ? `${activeGames.length} games` : "one game";

    if (freshUser.account.email && freshUser.security.confirmed) {
      sendmail({
        from: env.noreply,
        to: freshUser.account.email,
        subject: "Your turn",
        html: `
        <p>Hello ${freshUser.account.username}</p>
        <p>It's your turn on ${gameString},
        click <a href='http://${env.site}/user/${encodeURIComponent(freshUser.account.username!)}'>here</a> to see your active games.</p>
        <p>You can also change your email settings and unsubscribe <a href='http://${env.site}/account'>here</a> with a simple click.</p>`,
      }).catch(console.error);
    }

    await colls.users.updateOne(
      { _id: user._id },
      { $set: { "meta.lastGameNotification": new Date() }, $unset: { "meta.nextGameNotification": "" } }
    );
  } catch (err) {
    console.error(err);
  }
}

export function stripSensitiveFields(user: WithId<UserDoc>): WithId<UserDoc> {
  const { password: _password, ...account } = user.account;
  if (!user.security) {
    return { ...user, account: { ...account } } as WithId<UserDoc>;
  }
  const { confirmKey: _confirmKey, reset, ...securityRest } = user.security;
  const resetWithoutKey = reset
    ? (() => {
        const { key: _key, ...rest } = reset;
        return rest;
      })()
    : undefined;
  return {
    ...user,
    account: { ...account },
    security: { ...securityRest, reset: resetWithoutKey },
  } as WithId<UserDoc>;
}

export function userPublicInfo(user: WithId<UserDoc>) {
  return {
    _id: user._id,
    account: {
      username: user.account?.username,
      bio: user.account?.bio,
      karma: user.account?.karma,
    },
    createdAt: user.createdAt,
  };
}
