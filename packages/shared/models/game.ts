import { IAbstractGame, PlayerInfo } from "@bgs/types";
import { Model, Schema, Types } from "mongoose";

const playerInfoSchema = new Schema<PlayerInfo<Types.ObjectId>>({
  _id: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true,
  },

  name: String,
  remainingTime: Number,
  score: Number,
  dropped: Boolean,
  quit: Boolean,
  faction: String,
  voteCancel: Boolean,
  ranking: Number,
  elo: {
    initial: Number,
    delta: Number,
  },
});

const repr = {
  _id: {
    type: String,
    trim: true,
    minlength: [2, "A game id must be at least 2 characters"] as [number, string],
    maxlength: [25, "A game id must be at most 25 characters"] as [number, string],
  },
  players: [playerInfoSchema],
  creator: {
    type: Schema.Types.ObjectId,
    index: true,
  },
  currentPlayers: [
    {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
      deadline: {
        type: Date,
        index: true,
      },
      timerStart: Date,
    },
  ],
  lastMove: {
    type: Date,
    index: true,
  },
  data: {},
  status: {
    type: String,
    enum: ["open", "pending", "active", "ended"] as const,
    default: "open",
  },
  cancelled: {
    type: Boolean,
    default: false,
  },
  options: {
    setup: {
      playerOrder: {
        type: String,
        default: "random",
        enum: ["random", "join", "host"] as const,
      },
      nbPlayers: {
        type: Number,
        default: 2,
      },
      seed: {
        type: String,
        trim: true,
        minlength: [2, "A game seed must be at least 2 characters"] as [number, string],
        maxlength: [25, "A game seed must be at most 25 characters"] as [number, string],
      },
    },
    timing: {
      timePerMove: {
        type: Number,
        default: 15 * 60,
        min: 0,
        max: 24 * 3600,
      },
      timePerGame: {
        type: Number,
        default: 15 * 24 * 3600,
        min: 60,
        max: 15 * 24 * 3600,
        // enum: [1 * 3600, 24 * 3600, 3 * 24 * 3600, 15 * 24 * 3600]
      },
      timer: {
        start: {
          type: Number,
          min: 0,
          max: 24 * 3600 - 1,
        },
        end: {
          type: Number,
          min: 0,
          max: 24 * 3600 - 1,
        },
      },
      scheduledStart: Date,
    },
    meta: {
      unlisted: Boolean,
      minimumKarma: Number,
    },
  },

  context: {
    round: Number,
  },

  game: {
    name: String,
    version: Number,
    expansions: [String],

    options: {},
  },
};

export default function makeSchema<T extends IAbstractGame<Types.ObjectId>, U extends Model<T> = Model<T>>() {
  const schema = new Schema<T, U>(repr as any, { timestamps: true });

  // To... order open games & active games & closed games
  schema.index({ status: 1, lastMove: -1 });

  // To check a player's (dropped) games in the last X days
  schema.index({ "players._id": 1, lastMove: -1 });

  schema.index(
    { status: 1, scheduledStart: 1 },
    { partialFilterExpression: { status: "open", "options.timing.scheduledStart": { $exists: true } } }
  );

  return schema;
}
