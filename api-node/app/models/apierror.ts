import mongoose, { Schema, Model, Document, Types } from "mongoose";

export interface ApiErrorDocument extends Document {
  error: {
    name: string;
    message: string;
    stack: string[];
  };
  request: {
    url: string;
    method: string;
    /**
     * Stringified content because mongodb doesn't support dots in keys
     */
    body: string;
  };
  meta?: unknown;
  user: Types.ObjectId;
  updatedAt?: Date;
}

interface ApiErrorModel extends Model<ApiErrorDocument> {
  lastUnread(): Promise<ApiErrorDocument[]>;
}

const schema = new Schema<ApiErrorDocument, ApiErrorModel>(
  {
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
  },
  {
    timestamps: true,
    capped: { size: 10 * 1024 * 1024, max: 10 * 1000 },
  }
);

schema.static("lastUnread", async function (this: ApiErrorModel) {
  return await this.find({ read: false }).sort("-_id").limit(10);
});

schema.index({ user: 1, createdAt: -1 });

const ApiError = mongoose.model("ApiError", schema);

ApiError.createIndexes();

export default ApiError;
