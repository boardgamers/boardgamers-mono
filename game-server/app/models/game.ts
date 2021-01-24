import schema from "@lib/schemas/game";
import type { IAbstractGame } from "@lib/game";
import type { ObjectID } from "bson";
import mongoose from "mongoose";

export interface GameDocument extends mongoose.Document, IAbstractGame<ObjectID> {
  _id: string;
}

schema.pre("save", async function (this: GameDocument) {
  if (this.modifiedPaths().includes("data")) {
    this.data = JSON.parse(JSON.stringify(this.data));
  }
});

const Game = mongoose.model<GameDocument>("Game", schema);

export default Game;
