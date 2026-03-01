import type { IndexDescription, ObjectId } from "mongodb";

export interface RoomMetaDataDoc {
  _id?: ObjectId;
  room: string;
  user: ObjectId;
  notes?: string;
  lastChatMessageViewed?: Date;
}

export const ROOM_METADATA_COLLECTION = "roommetadatas";

export const roomMetaDataIndexes: IndexDescription[] = [
  // api: unique room+user lookup for chat metadata
  { key: { room: 1, user: 1 }, unique: true },
];
