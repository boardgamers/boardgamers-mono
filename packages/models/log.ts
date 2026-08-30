import { z } from "zod";
import type { Jsonify } from "type-fest";
import { zObjectId, zDate } from "./helpers.ts";

export const logSchema = z.object({
	kind: z.enum(["processGameEnded", "processPlayerDrop", "mailChange", "socialUnlink"]),
	data: z.object({
		game: z.string().optional(),
		player: zObjectId().optional(),
		change: z.object({ from: z.string().optional(), to: z.string() }).optional(),
		// socialUnlink: which provider was disconnected
		provider: z.string().optional(),
	}),
	createdAt: zDate().optional(),
});

export type LogDoc = z.output<typeof logSchema>;
export type LogFront = Jsonify<LogDoc>;

export const LOGS_COLLECTION = "logs";

/** Capped collection: 100 MB */
export const logsCollectionOptions = { capped: true, size: 100 * 1000 * 1000 } as const;
