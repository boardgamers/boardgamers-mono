import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const userSchema = z.object({
  _id: zObjectId().optional(),
  account: z.object({
    username: z.string(),
    email: z.string(),
    password: z.string().optional(),
    karma: z.number(),
    termsAndConditions: zDate().optional(),
    social: z.object({
      google: z.string().optional(),
      facebook: z.string().optional(),
      discord: z.string().optional(),
    }),
    avatar: z.string(),
    bio: z.string(),
  }),
  settings: z.object({
    mailing: z
      .object({
        newsletter: z.boolean().optional(),
        game: z
          .object({
            delay: z.number().optional(),
            activated: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    game: z
      .object({
        soundNotification: z.boolean().optional(),
      })
      .optional(),
    home: z
      .object({
        showMyGames: z.boolean().optional(),
      })
      .optional(),
  }),
  security: z.object({
    lastIp: z.string().optional(),
    lastLogin: z
      .object({
        ip: z.string(),
        date: zDate(),
      })
      .optional(),
    lastActive: zDate().optional(),
    lastOnline: zDate().optional(),
    confirmed: z.boolean().optional(),
    confirmKey: z.string().optional(),
    reset: z
      .object({
        key: z.string(),
        issued: zDate(),
      })
      .optional(),
    slug: z.string().optional(),
  }),
  meta: z.object({
    nextGameNotification: zDate().optional(),
    lastGameNotification: zDate().optional(),
  }),
  authority: z.string(),
  createdAt: zDate(),
  updatedAt: zDate(),
});

export type UserDoc = z.output<typeof userSchema>;
export type UserFront = Jsonify<UserDoc>;

export const USERS_COLLECTION = "users";

export const userIndexes: IndexDescription[] = [
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
