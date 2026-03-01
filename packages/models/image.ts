import type { IndexDescription, ObjectId } from "mongodb";

export interface ImageDoc {
  _id?: ObjectId;
  formats: string[];
  images: Record<string, { mime: string; raw: Buffer; size: number }>;
  key: string;
  ref: ObjectId;
  refType: "User";
  createdAt?: Date;
  updatedAt?: Date;
}

export const IMAGES_COLLECTION = "images";

export const imageIndexes: IndexDescription[] = [
  // api: avatar/image lookup per user
  { key: { ref: 1, key: 1 } },
];
