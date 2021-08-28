import mongoose, { Types } from "mongoose";

export interface LogItem {
  kind: "processGameEnded" | "processPlayerDrop" | "mailChange";
  data: {
    game?: string;
    player?: Types.ObjectId;
    change?: {
      from: string;
      to: string;
    };
  };
}

interface LogDocument extends mongoose.Document, LogItem {}

const schema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["processGameEnded", "processPlayerDrop", "mailChange"],
    },

    data: {},
  },
  { timestamps: true, capped: 100 * 1024 * 1024 }
);

const Log = mongoose.model<LogDocument>("log", schema);

export { Log };
