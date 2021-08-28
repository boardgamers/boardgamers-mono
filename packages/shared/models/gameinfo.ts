import type { GameInfo } from "@shared/types/gameinfo";
import { Document, Model, Schema } from "mongoose";

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
      enum: ["checkbox", "select"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
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

export default function makeSchema<T extends Document & GameInfo, U extends Model<T> = Model<T>>() {
  return new Schema<T, U>(repr, { timestamps: true });
}
