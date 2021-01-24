import makeSchema from "@lib/schemas/game";
import type { IAbstractGame } from "@lib/game";
import mongoose, { Types } from "mongoose";

const schema = makeSchema<GameDocument>();
export interface GameDocument extends mongoose.Document, IAbstractGame<Types.ObjectId> {
  _id: string;
}

schema.pre("save", async function (this: GameDocument) {
  if (this.modifiedPaths().includes("data")) {
    this.data = JSON.parse(JSON.stringify(this.data));
  }
});

const Game = mongoose.model("Game", schema);

export default Game;
