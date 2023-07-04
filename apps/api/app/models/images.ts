import { Document, Model, model, ObjectId, Schema } from "mongoose";

export interface Image {
  formats: string[];
  images: Map<string, { mime: string; raw: Buffer; size: number }>;
  key: string;
  ref: ObjectId;
  refType: string;
}

interface ImageDocument extends Image, Document {}
interface ImageModel extends Model<ImageDocument> {}

const schema = new Schema<ImageDocument, ImageModel>(
  {
    formats: [String],
    images: {
      type: Schema.Types.Map,
      of: {
        mime: String,
        raw: Buffer,
        size: Number,
      },
    },
    key: String,
    ref: {
      type: Schema.Types.ObjectId,
      refPath: "refType",
    },
    refType: {
      type: String,
      enum: ["User"],
    },
  },
  { timestamps: true }
);

schema.index({
  ref: 1,
  key: 1,
});

export const ImageCollection = model("Image", schema);
