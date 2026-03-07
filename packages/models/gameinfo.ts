import { z } from "zod";
import type { Jsonify } from "type-fest";

export const viewerInfoSchema = z.object({
  url: z.string(),
  dependencies: z
    .object({
      scripts: z.array(z.string()),
      stylesheets: z.array(z.string()),
    })
    .optional(),
  topLevelVariable: z.string().optional(),
  fullScreen: z.boolean().optional(),
  trusted: z.boolean().optional(),
  replayable: z.boolean().optional(),
});

export type ViewerInfo = z.output<typeof viewerInfoSchema>;

export const gameInfoOptionSchema = z.object({
  label: z.string(),
  type: z.enum(["checkbox", "select", "hidden", "category"]),
  default: z.unknown(),
  category: z.string().optional(),
  name: z.string(),
  items: z
    .array(z.object({ name: z.string(), label: z.string() }))
    .nullable()
    .optional(),
});

export type GameInfoOption = z.output<typeof gameInfoOptionSchema>;

export const gameInfoSchema = z.object({
  _id: z.object({
    game: z.string(),
    version: z.number(),
  }),
  label: z.string(),
  description: z.string().optional(),
  rules: z.string().optional(),
  viewer: viewerInfoSchema.extend({ alternate: viewerInfoSchema.optional() }),
  engine: z
    .object({
      package: z.object({
        name: z.string(),
        version: z.string(),
      }),
      entryPoint: z.string(),
    })
    .optional(),
  preferences: z.array(gameInfoOptionSchema).optional(),
  settings: z.array(gameInfoOptionSchema.extend({ faction: z.string().optional() })).optional(),
  options: z.array(gameInfoOptionSchema).optional(),
  players: z.array(z.number()),
  expansions: z.array(z.object({ label: z.string(), name: z.string() })).optional(),
  factions: z
    .object({
      avatars: z.boolean().optional(),
    })
    .optional(),
  meta: z.object({
    public: z.boolean(),
    needOwnership: z.boolean().optional(),
  }),
});

export type GameInfoDoc = z.output<typeof gameInfoSchema>;
export type GameInfoFront = Jsonify<GameInfoDoc>;

export const GAME_INFOS_COLLECTION = "gameinfos";
