import { Model, model, ObjectId, Schema } from "mongoose";

export interface Image {
  mime: string;
  height: number;
  width: number;
  size: number;
  data: Buffer;
  key: string;
  ref: ObjectId;
  refType: string;
}

interface ImageDocument extends Image, Document {}
interface ImageModel extends Model<ImageDocument> {}

const schema = new Schema<ImageDocument, ImageModel>(
  {
    mime: String,
    height: Number,
    width: Number,
    size: Number,
    data: Buffer,
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

ImageCollection.createIndexes();
