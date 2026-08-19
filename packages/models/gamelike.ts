import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// One doc per (game, user) pair — a user liking a boardgame (GameInfo `_id.game`).
export const gameLikeSchema = z.object({
	_id: zObjectId().optional(),
	game: z.string(),
	user: zObjectId(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type GameLikeDoc = z.output<typeof gameLikeSchema>;
export type GameLikeFront = Jsonify<GameLikeDoc>;

export const GAME_LIKES_COLLECTION = "gamelikes";

export const gameLikeIndexes: IndexDescription[] = [
	// One like per (game, user); also serves per-game countDocuments
	{ key: { game: 1, user: 1 }, unique: true },
	// "Games this user likes" (sidebar ordering, liked flags in the game list)
	{ key: { user: 1 } },
];
