import makeSchema from "@bgs/models/game";
import { GameStatus, IAbstractGame } from "@bgs/types";
import mongoose, { Types } from "mongoose";

const schema = makeSchema<GameDocument, GameModel>();
export interface GameDocument extends IAbstractGame<Types.ObjectId>, mongoose.Document {}

export interface GameModel extends mongoose.Model<GameDocument> {
  findWithPlayer(playerId: Types.ObjectId): mongoose.Query<GameDocument[], GameDocument>;
  findWithPlayersTurn(playerId: Types.ObjectId): mongoose.Query<GameDocument[], GameDocument>;

  /** Basics projection */
  basics(): string[];
}

// For websocket server. To find whether games have updated
schema.index({ updatedAt: 1 });

schema.static("findWithPlayer", function (this: GameModel, playerId: Types.ObjectId) {
  return this.find({ "players._id": playerId }).sort("-lastMove");
});

schema.static("findWithPlayersTurn", function (this: GameModel, playerId: Types.ObjectId) {
  const conditions = { status: { $in: ["active", "open"] as GameStatus[] }, "currentPlayers._id": playerId };
  return this.find(conditions).sort({ status: -1, lastMove: -1 });
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
    "context.round",
    "lastMove",
    "createdAt",
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

const Game = mongoose.model("Game", schema);
export { Game };
