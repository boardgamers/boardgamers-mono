import type { ObjectId } from "mongodb";

export interface LogDoc {
  kind: "processGameEnded" | "processPlayerDrop" | "mailChange";
  data: {
    game?: string;
    player?: ObjectId;
    change?: { from: string; to: string };
  };
  createdAt?: Date;
}

export const LOGS_COLLECTION = "logs";

/** Capped collection: 100 MB */
export const logsCollectionOptions = { capped: true, size: 100 * 1000 * 1000 } as const;
