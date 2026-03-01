import type { IndexDescription, ObjectId } from "mongodb";

export interface JwtRefreshTokenDoc {
  _id?: ObjectId;
  user: ObjectId;
  code: string;
  createdAt: Date;
  updatedAt?: Date;
}

export const JWT_REFRESH_TOKENS_COLLECTION = "jwtrefreshtokens";

export const jwtRefreshTokenIndexes: IndexDescription[] = [
  // api: lookup tokens by user
  { key: { user: 1 } },
  // api: unique refresh code
  { key: { code: 1 }, unique: true },
  // api: auto-expire after 120 days
  { key: { createdAt: 1 }, expireAfterSeconds: 120 * 24 * 3600 },
];
