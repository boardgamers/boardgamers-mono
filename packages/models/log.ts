import { z } from "zod";
import { zObjectId, zDate } from "./helpers.ts";

export const logSchema = z.object({
  kind: z.enum(["processGameEnded", "processPlayerDrop", "mailChange"]),
  data: z.object({
    game: z.string().optional(),
    player: zObjectId().optional(),
    change: z.object({ from: z.string().optional(), to: z.string() }).optional(),
  }),
  createdAt: zDate().optional(),
});

export type LogDoc = z.output<typeof logSchema>;

export const LOGS_COLLECTION = "logs";

/** Capped collection: 100 MB */
export const logsCollectionOptions = { capped: true, size: 100 * 1000 * 1000 } as const;
