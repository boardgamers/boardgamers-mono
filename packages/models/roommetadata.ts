import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const roomMetaDataSchema = z.object({
  _id: zObjectId().optional(),
  room: z.string(),
  user: zObjectId(),
  notes: z.string().optional(),
  lastChatMessageViewed: zDate().optional(),
});

export type RoomMetaDataDoc = z.output<typeof roomMetaDataSchema>;

export const ROOM_METADATA_COLLECTION = "roommetadatas";

export const roomMetaDataIndexes: IndexDescription[] = [
  // api: unique room+user lookup for chat metadata
  { key: { room: 1, user: 1 }, unique: true },
];
