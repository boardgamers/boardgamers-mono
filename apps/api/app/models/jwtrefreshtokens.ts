import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { JwtRefreshTokenDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { env } from "../config/index.ts";

export function accessTokenDuration() {
  return 3600 * 1000;
}

export async function createAccessToken(token: JwtRefreshTokenDoc, scopes: string[] | undefined, isAdmin: boolean) {
  const user = await colls.users.findOne({ _id: token.user });
  const options = { expiresIn: accessTokenDuration() / 1000, algorithm: env.jwt.algorithm };
  return jwt.sign({ userId: user._id, scopes: scopes ?? ["all"], isAdmin }, env.jwt.keys.private, options);
}

export function generateRefreshCode() {
  return crypto.randomBytes(15).toString("base64");
}
