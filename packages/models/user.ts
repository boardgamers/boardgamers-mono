import type { IAbstractUser } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface UserDoc extends IAbstractUser {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const USERS_COLLECTION = "users";

export const userIndexes: IndexDescription[] = [
  // api: login / registration lookup
  { key: { "account.username": 1 }, unique: true, sparse: true },
  // api: login / registration lookup
  { key: { "account.email": 1 }, unique: true, sparse: true },
  // api: social OAuth login
  { key: { "account.social.google": 1 }, unique: true, sparse: true },
  // api: social OAuth login
  { key: { "account.social.facebook": 1 }, unique: true, sparse: true },
  // api: social OAuth login
  { key: { "account.social.discord": 1 }, unique: true, sparse: true },
  // api: URL-based user lookup (profile pages)
  { key: { "security.slug": 1 }, unique: true, sparse: true },
  // api: admin IP-based lookups
  { key: { "security.lastIp": 1 } },
];
