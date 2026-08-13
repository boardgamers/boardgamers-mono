import { z } from "zod";
import type { Jsonify } from "type-fest";
import { zDate } from "./helpers.ts";

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

// npm package name grammar (https://docs.npmjs.com/package-name-guidelines), enforced
// because the game-server installer embeds this value in `npm install <name>@<version>`
// argv (issue #270 — shell injection).
export const npmPackageNameSchema = z
	.string()
	.max(214)
	.regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)?$/, "invalid npm package name")
	.refine((name) => name.toLowerCase() !== "node_modules" && name.toLowerCase() !== "favicon.ico", {
		message: "reserved npm package name",
	});

// Exact version only (no ranges): the installer pins the dependency with
// --save-exact and the DB validation would reject range characters like `^`.
// Empty string = "no engine" — the admin panel initializes new games with an
// empty package name/version and this route doubles as the create form.
export const engineVersionSchema = z
	.string()
	.max(64)
	.regex(/^(\d+\.\d+\.\d+(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?)?$/, "invalid semver version");

export const gameInfoOptionSchema = z.object({
	label: z.string(),
	type: z.enum(["checkbox", "select", "hidden", "category"]),
	default: z.unknown().optional(),
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
	// Public display name for games whose real name is trademarked (issue #106) —
	// e.g. "Gem Trader" for a game labeled "Splendor". Wherever the game is shown,
	// the alias is primary and the canonical label is noted as the rules source
	// ("Splendor rules"). Games without an alias render as before.
	alias: z.string().min(1).optional(),
	description: z.string().optional(),
	rules: z.string().optional(),
	links: z
		.object({
			source: z.string().optional(),
			bgg: z.string().optional(),
			publisher: z.string().optional(),
			buy: z.string().optional(),
		})
		.optional(),
	viewer: viewerInfoSchema.extend({ alternate: viewerInfoSchema.optional() }),
	engine: z
		.object({
			package: z.object({
				name: npmPackageNameSchema,
				version: engineVersionSchema,
				// When set (admin-uploaded bundle, #268), the game-server installs the
				// engine from this npm-pack tarball URL instead of the registry.
				// name/version still key the install path and the ESM cache bust.
				url: z.url().optional(),
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
		// Set when the game's engine implements `moveAI` — enables adding bot players
		// at game creation. Auto-detected by the game-server installer (probes the
		// engine's entry point for a moveAI export on install / for unprobed engines).
		bots: z.boolean().optional(),
	}),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type GameInfoDoc = z.output<typeof gameInfoSchema>;
export type GameInfoFront = Jsonify<GameInfoDoc>;

export const GAME_INFOS_COLLECTION = "gameinfos";
