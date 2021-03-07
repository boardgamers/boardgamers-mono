import { ObjectID } from "bson";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config";
import { User } from "./user";

const Schema = mongoose.Schema;

interface JwtRefreshTokenDocument extends mongoose.Document {
  user: ObjectID;
  code: string;

  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;

  // By default, scopes = ["all"]
  createAccessToken(scopes: string[], isAdmin: boolean): Promise<string>;
}

interface JwtRefreshTokenModel extends mongoose.Model<JwtRefreshTokenDocument> {
  accessTokenDuration(): number;
}

const schema = new Schema<JwtRefreshTokenDocument, JwtRefreshTokenModel>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(15).toString("base64"),
    },
    createdAt: {
      type: Date,
      expires: 120 * 24 * 3600,
    },
  },
  { timestamps: true }
);

schema.method("createAccessToken", async function (this: JwtRefreshTokenDocument, scopes: string[], isAdmin: boolean) {
  const user = await User.findById(this.user);
  const options = { expiresIn: JwtRefreshToken.accessTokenDuration() / 1000, algorithm: env.jwt.algorithm };
  return jwt.sign({ userId: user._id, scopes, isAdmin }, env.jwt.keys.private, options);
});

schema.static("accessTokenDuration", function (this: JwtRefreshTokenModel) {
  return 3600 * 1000;
});

const JwtRefreshToken = mongoose.model<JwtRefreshTokenDocument, JwtRefreshTokenModel>("JwtRefreshToken", schema);

export { JwtRefreshToken };
