import { ApiError } from "@bgs/types/api-error";
import { Document, Model, Schema, Types } from "mongoose";

export interface ApiErrorDocument extends Document, ApiError<Types.ObjectId> {}

const repr = {
  error: {
    name: String,
    message: String,
    stack: [String],
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  request: {
    url: String,
    method: String,
    body: String,
  },
  meta: {},
};

export default function makeSchema<U extends Model<ApiErrorDocument> = Model<ApiErrorDocument>>() {
  const schema = new Schema<ApiErrorDocument, U>(repr, {
    timestamps: true,
    capped: { size: 10 * 1024 * 1024, max: 10 * 1000 },
  });

  schema.index({ user: 1, createdAt: -1 });

  return schema;
}
