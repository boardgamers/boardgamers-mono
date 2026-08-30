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
	// Platform-driven bot slot (auto-plays via the engine's moveAI). No user account:
	// the _id is a placeholder, and bots are excluded from emails, karma and Elo.
	isBot: z.boolean().optional(),
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

// The api's /game/:id/players payload augments the stored player info with public
// per-user fields (karma — same public set as userPublicInfo). Optional so bots and
// the raw game.players list (no user doc) need not carry it.
export type PlayerInfoFront = Jsonify<PlayerInfo> & { karma?: number };

export const gameSchema = z.object({
	_id: z.string(),
	players: z.array(playerInfoSchema),
	creator: zObjectId(),
	// Creator-authored free text for THIS open game (e.g. "casual, beginners
	// welcome"), distinct from the boardgame's own description. Markdown — always
	// sanitize on render.
	description: z.string().max(1000).optional(),
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
	context: z
		.object({
			round: z.number(),
		})
		.optional(),
	options: z.object({
		setup: z.object({
			seed: z.string(),
			nbPlayers: z.number(),
			playerOrder: playerOrderSchema,
		}),
		timing: z.object({
			timePerGame: z.number().optional(),
			timePerMove: z.number().optional(),
			timer: z
				.object({
					start: z.number(),
					end: z.number(),
				})
				.optional(),
			scheduledStart: zDate().optional(),
		}),
		meta: z
			.object({
				unlisted: z.boolean().optional(),
				minimumKarma: z.number().optional(),
				eloRange: z
					.object({
						min: z.number(),
						max: z.number(),
					})
					.optional(),
			})
			.optional(),
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
	// Set once the inactivity warning has been posted for the current stall (#94);
	// cleared by the game-server on the next move. `cancelWarn` announces the
	// penalty-free cancel (autoDrop off/dry-run — and pre-auto-drop stalls, which keep
	// the cancel they were promised); `dropWarn` announces the auto-drop.
	cancelWarn: z.boolean().optional(),
	dropWarn: z.boolean().optional(),
	// When the drop warning was posted: the auto-drop fires only once the promised
	// notice has elapsed since the warning, not just N days past the deadline — so a
	// late warning (sweep backlog/outage) can't collapse the notice window.
	dropWarnAt: zDate().optional(),
	lastMove: zDate().optional(),
	// Denormalized summary of the last move, written by the game-server so listings
	// can display it without loading game.data or replaying the engine. Null until
	// the first move (game start sets it explicitly). `move` is the engine's log
	// line for the move (what the viewer shows), read from the log entries the move
	// appended via logSlice; it falls back to the raw move notation when the engine
	// logged nothing. Bounded to ~80 chars.
	// `player`/`at` are optional: after an engine replay the stored info is rebuilt
	// from the rewound log, where the mover isn't always tagged on the log entry and
	// the original move's timestamp is unknowable.
	lastMoveInfo: z
		.object({
			player: zObjectId().optional(),
			move: z.string(),
			at: zDate().optional(),
			moveNumber: z.number(),
		})
		.nullable()
		.optional(),
	createdAt: zDate(),
	updatedAt: zDate(),
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
	// api: inactivity sweep prefilter (status + earliest expired deadline)
	{ key: { status: 1, "currentPlayers.deadline": 1 } },
	// api: open-games-per-creator cap on game creation
	{ key: { creator: 1, status: 1 } },
];
