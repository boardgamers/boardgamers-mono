import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const jwtRefreshTokenSchema = z.object({
  _id: zObjectId().optional(),
  user: zObjectId(),
  code: z.string(),
  createdAt: zDate(),
  updatedAt: zDate().optional(),
});

export type JwtRefreshTokenDoc = z.output<typeof jwtRefreshTokenSchema>;

export const JWT_REFRESH_TOKENS_COLLECTION = "jwtrefreshtokens";

export const jwtRefreshTokenIndexes: IndexDescription[] = [
  // api: lookup tokens by user
  { key: { user: 1 } },
  // api: unique refresh code
  { key: { code: 1 }, unique: true },
  // api: auto-expire after 120 days
  { key: { createdAt: 1 }, expireAfterSeconds: 120 * 24 * 3600 },
];
