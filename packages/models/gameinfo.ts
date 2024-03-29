import type { GameInfo } from "@bgs/types";
import { Model, Schema } from "mongoose";

const optionSchema = [
  {
    _id: false,
    label: {
      type: String,
      trim: true,
      required: true,
    },
    type: {
      type: String,
      enum: ["checkbox", "select", "hidden", "category"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    default: {},
    category: String,
    // When it's a select
    items: [
      {
        _id: false,
        name: {
          type: String,
          required: true,
        },
        label: {
          type: String,
          required: true,
        },
      },
    ],
  },
];

const repr = {
  _id: {
    game: {
      type: String,
      trim: true,
      required: true,
      minlength: 1,
    },
    version: {
      type: Number,
      required: true,
    },
  },
  label: { type: String, required: true },
  rules: String,
  description: String,
  viewer: {
    url: {
      type: String,
      required: true,
    },
    topLevelVariable: {
      type: String,
      required: true,
    },
    dependencies: {
      scripts: [String],
      stylesheets: [String],
    },
    fullScreen: Boolean,
    trusted: Boolean,
    replayable: Boolean,

    alternate: {
      url: {
        type: String,
      },
      topLevelVariable: {
        type: String,
      },
      dependencies: {
        scripts: [String],
        stylesheets: [String],
      },
      fullScreen: Boolean,
      trusted: Boolean,
      replayable: Boolean,
    },
  },
  engine: {
    package: {
      name: String,
      version: String,
    },
    entryPoint: String,
  },
  factions: {
    avatars: {
      type: Boolean,
      default: false,
    },
  },
  preferences: optionSchema,
  settings: [{ ...optionSchema[0], faction: String }],
  options: optionSchema,
  players: [Number],
  expansions: [
    {
      _id: false,
      name: String,
      label: String,
    },
  ],
  meta: {
    public: {
      type: Boolean,
      default: false,
    },
    needOwnership: {
      type: Boolean,
      default: true,
    },
  },
};

export default function makeSchema<U extends Model<GameInfo> = Model<GameInfo>>() {
  return new Schema<GameInfo, U>(repr, { timestamps: true });
}
