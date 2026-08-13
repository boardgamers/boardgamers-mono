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

// One doc per game version: everything that changes when a new version of
// the engine/viewer is published. Game-level identity + configuration (name, rules,
// player counts, options…) lives in `gameMetadataSchema`, a single doc per game —
// historically those fields were duplicated identically onto every version doc.
export const gameVersionSchema = z.object({
	_id: z.object({
		game: z.string(),
		version: z.number(),
	}),
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
	// Engine-defined configuration: these describe how the engine exposes its
	// options/preferences/factions/expansions, so they change with the engine and
	// stay version-scoped (unlike the game's identity/rules/player counts, which are
	// game-level metadata). `expansions` in particular is a setup option that can be
	// implemented in only some versions (new content added in a later version).
	preferences: z.array(gameInfoOptionSchema).optional(),
	settings: z.array(gameInfoOptionSchema.extend({ faction: z.string().optional() })).optional(),
	options: z.array(gameInfoOptionSchema).optional(),
	expansions: z.array(z.object({ label: z.string(), name: z.string() })).optional(),
	factions: z
		.object({
			avatars: z.boolean().optional(),
		})
		.optional(),
	// Whether this version is listed and open to everyone. Version-scoped (NOT
	// game-scoped): a game can have a public v1 and a beta v2 — non-public
	// versions stay reachable for users with an `access.maxVersion` grant.
	public: z.boolean(),
	meta: z
		.object({
			// Set when the game's engine implements `moveAI` — enables adding bot players
			// at game creation. Auto-detected by the game-server installer (probes the
			// engine's entry point for a moveAI export on install / for unprobed engines).
			bots: z.boolean().optional(),
			// Retired version: the game-server installer skips it (and prunes a
			// previously-installed engine) and it is never picked as the latest public
			// version, but its viewer keeps being served so old games stay replayable.
			// Only settable via the admin archive action — blocked while the version is
			// the latest public one or has ongoing games.
			archived: z.boolean().optional(),
			// Default (not optional): `meta` holds only server-managed flags now
			// (installer-set `bots`, archive-action `archived`), so producer payloads
			// legitimately omit it — but readers can rely on it being an object.
		})
		.prefault({}),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type GameVersionDoc = z.output<typeof gameVersionSchema>;

// One doc per game: the game's identity and configuration, shared by all its
// versions. These fields were previously duplicated identically onto every version
// doc in `gameInfos` — hoisted here so they can drift no further (#298).
export const gameMetadataSchema = z.object({
	_id: z.string(),
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
	players: z.array(z.number()),
	// Whether playing the game requires owning the physical board game. Game-scoped
	// (a property of the game itself, not of any engine version), so it lives on the
	// per-game metadata doc — surfaced on the merged game-info as `needOwnership`.
	needOwnership: z.boolean().optional(),
	// Number of users who liked the game. Game-scoped (a like targets the game, not
	// a version), so it lives on the single per-game metadata doc — this makes the
	// #289 multi-version likeCount bug (a `$inc` bumping only one version's doc)
	// impossible by construction. Maintained by the like/unlike service, never
	// edited through the admin metadata form.
	//
	// Extension point: this collection is the home for future computed game-level
	// counters — e.g. activity / trending scores if we don't want trending based on
	// absolute likes. Add such numeric fields here (optional, server-maintained) and
	// pick them onto `gameInfoSchema` below to surface them on the merged game-info.
	likeCount: z.number().int().min(0).optional(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type GameMetadataDoc = z.output<typeof gameMetadataSchema>;

// The game-level keys hoisted out of `gameInfos` into `gameMetadatas` (#298):
// identity + player counts. Engine-defined configuration (preferences/settings/
// options/expansions/factions) stays version-scoped. Shared by the storage split
// and the migration + admin route that route a field to one collection or the other.
export const GAME_METADATA_FIELDS = [
	"label",
	"alias",
	"description",
	"rules",
	"links",
	"players",
	"needOwnership",
] as const;

// The merged document the API serves and the app passes around: a version doc plus
// that version's game metadata. Consumers (web, admin, seed) see this shape — the
// storage split into `gameInfos` (per version) + `gameMetadatas` (per game) is an
// api-data-layer concern.
export const gameInfoSchema = gameVersionSchema
	.merge(
		gameMetadataSchema.pick({
			label: true,
			alias: true,
			description: true,
			rules: true,
			links: true,
			players: true,
			needOwnership: true,
			likeCount: true,
		}),
	)
	.extend({
		// Serialization-only (computed by the api per request, never stored): does the
		// current user like this game. Not part of the DB validation schema.
		liked: z.boolean().optional(),
	});

export type GameInfoDoc = z.output<typeof gameInfoSchema>;
export type GameInfoFront = Jsonify<GameInfoDoc>;

export const GAME_INFOS_COLLECTION = "gameinfos";
export const GAME_METADATAS_COLLECTION = "gamemetadatas";
