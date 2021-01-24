import mongoose from "mongoose";
import { ObjectId } from "bson";
import { IAbstractGame } from "@lib/game";
import schema from "@lib/schemas/game";

export interface GameDocument extends IAbstractGame<ObjectId>, mongoose.Document {
  _id: string;
}

export interface GameModel extends mongoose.Model<GameDocument> {
  findWithPlayer(playerId: ObjectId): mongoose.Query<GameDocument[], GameDocument>;
  findWithPlayersTurn(playerId: ObjectId): mongoose.Query<GameDocument[], GameDocument>;
  findWithBoardgame(boardgame: string): mongoose.Query<GameDocument[], GameDocument>;

  /** Basics projection */
  basics(): string[];
}

// For websocket server. To find whether games have updated
schema.index({ updatedAt: 1 });

// @ts-ignore
schema.static("findWithPlayer", function (this: GameModel, playerId: ObjectId) {
  return this.find({ "players._id": playerId }).sort("-lastMove");
});

// @ts-ignore
schema.static("findWithPlayersTurn", function (this: GameModel, playerId: ObjectId) {
  // The first condition is to leverage the index
  const conditions = { status: "active" as "active", "currentPlayers._id": playerId };
  return this.find(conditions).sort("-lastMove");
});

// @ts-ignore
schema.static("findWithBoardgame", function (this: GameModel, boardgame: string) {
  return this.find({ "game.name": boardgame }).sort("-lastMove");
});

schema.static("basics", () => {
  return [
    "players",
    "currentPlayers",
    "options.setup.nbPlayers",
    "options.timing",
    "game.expansions",
    "game.name",
    "game.version",
    "status",
    "creator",
    "data.round",
    "lastMove",
  ];
});

schema.pre("validate", function (this: GameDocument) {
  if (!this.options.timing.timePerMove) {
    this.options.timing.timePerMove = 15 * 60;
  } else if (this.options.timing.timePerMove > 24 * 3600) {
    this.options.timing.timePerMove = 24 * 3600;
  }

  if (!this.options.timing.timePerGame) {
    this.options.timing.timePerGame = 15 * 24 * 3600;
  }
});

// @ts-ignore
const Game: GameModel = mongoose.model<GameDocument, GameModel>("Game", schema);
export default Game;
