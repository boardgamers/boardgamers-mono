import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const playerOrderSchema = z.enum(["random", "host", "join"]);
export type PlayerOrder = z.output<typeof playerOrderSchema>;

export const gameStatusSchema = z.enum(["open", "active", "ended"]);
export type GameStatus = z.output<typeof gameStatusSchema>;

export const playerInfoSchema = z.object({
  _id: zObjectId(),
  remainingTime: z.number().nullable().optional(),
  score: z.number(),
  dropped: z.boolean().optional(),
  quit: z.boolean().optional(),
  name: z.string(),
  faction: z.string().nullable().optional(),
  voteCancel: z.boolean().optional(),
  ranking: z.number().optional(),
  pending: z.boolean().optional(),
  elo: z
    .object({
      initial: z.number().optional(),
      delta: z.number().optional(),
    })
    .optional(),
});

export type PlayerInfo = z.output<typeof playerInfoSchema>;
export type PlayerInfoFront = Jsonify<PlayerInfo>;

export const gameSchema = z.object({
  _id: z.string(),
  players: z.array(playerInfoSchema),
  creator: zObjectId(),
  currentPlayers: z
    .array(
      z.object({
        _id: zObjectId(),
        timerStart: zDate(),
        deadline: zDate().optional(),
      }),
    )
		.nullable()
    .optional(),
  data: z.unknown().optional(),
  context: z.object({
    round: z.number(),
  }).optional(),
  options: z.object({
    setup: z.object({
      seed: z.string(),
      nbPlayers: z.number(),
	      playerOrder: playerOrderSchema,
    }),
    timing: z.object({
      timePerGame: z.number().optional(),
      timePerMove: z.number().optional(),
      timer: z.object({
        start: z.number(),
        end: z.number(),
      }).optional(),
      scheduledStart: zDate().optional(),
    }),
    meta: z.object({
      unlisted: z.boolean().optional(),
      minimumKarma: z.number().optional(),
    }).optional(),
  }),
  game: z.object({
    name: z.string(),
    version: z.number(),
    expansions: z.array(z.string()),
    options: z.unknown().optional(),
  }),
  status: gameStatusSchema,
  ready: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  lastMove: zDate().optional(),
  createdAt: zDate().optional(),
  updatedAt: zDate().optional(),
});

export type GameDoc = z.output<typeof gameSchema>;
export type GameFront = Jsonify<GameDoc>;

export const GAMES_COLLECTION = "games";

export const gameIndexes: IndexDescription[] = [
  // api: used for sorting active/recent games
  { key: { updatedAt: 1 } },
  // api: game listings by status, sorted by last move; game-server: same
  { key: { status: 1, lastMove: -1 } },
  // api: find games by player; game-server: same
  { key: { "players._id": 1, lastMove: -1 } },
  // api: scheduled start lookup for open games
  {
    key: { status: 1, "options.timing.scheduledStart": 1 },
    partialFilterExpression: { status: "open", "options.timing.scheduledStart": { $exists: true } },
  },
];
