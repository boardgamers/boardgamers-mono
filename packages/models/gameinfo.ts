import { z } from "zod";
import type { Jsonify } from "type-fest";
import { zDate, zObjectId } from "./helpers.ts";

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

// Lifecycle of a game entry (#340). Absent = "implemented" (every pre-#340 doc is a
// real game). A "requested" doc is a whole-game request: label + description +
// meeple-votes (the regular gamelike mechanic), no version yet — it is excluded
// from the game list / sidebar / new-game. When an admin uploads the first version
// it flips to "beta" and KEEPS showing on the requests page (an implementation
// exists but is not publicly released — players can follow the beta there); once a
// version is saved public the game is out of beta and the status is cleared (→
// absent = implemented). The status is derived data: which bucket a game falls in
// always follows from its version docs, re-stamped on every version upsert/delete
// — unless the game is `unlisted` (see gameMetadataSchema), which pins it to
// "implemented". ("Meta" in the name to avoid clashing with the game-lifecycle
// `gameStatusSchema` in game.ts.)
export const gameMetaStatusSchema = z.enum(["implemented", "requested", "beta"]);

export type GameMetaStatus = z.output<typeof gameMetaStatusSchema>;

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
//
// Per-language translations of the game-level free-text fields, keyed by base
// language subtag ("de", "fr", …) — part of the #306 multi-language feature.
// The top-level description/rules/credits stay the English (source) text and
// the per-field fallback. Named `translations` (not `i18n`/`localized`) to match
// the shape other #306 slices put on their docs. Not in GAME_METADATA_FIELDS:
// the admin metadata form round-trips only those whitelisted keys, so a regular
// metadata save can never clobber translations stored on the doc (editing UI +
// LLM auto-translate are follow-ups). Deliberately NOT picked onto
// `gameInfoSchema`: the api resolves the request's language at merge time and
// serves the winning string in the regular description/rules/credits slots, so
// clients and payloads stay unchanged.
export const gameMetadataTranslationsSchema = z.record(
	z.string().regex(/^[a-z]{2,3}$/, "language keys must be base subtags (2–3 lowercase letters)"),
	z.object({
		description: z.string().optional(),
		rules: z.string().optional(),
		credits: z.string().optional(),
		// Stamped by the LLM translate endpoints (#306 follow-up): a content
		// hash of the source strings the overlay was translated from (the
		// api's `metadataSourceHash`). The overlay is OUTDATED when the hash
		// of the current top-level description/rules/credits differs. A hash,
		// NOT a timestamp: the doc's `updatedAt` bumps on every write (likes,
		// status recomputes, the overlay write itself), so a timestamp
		// comparison would self-invalidate — the hash only moves when the
		// source text changes. No `lang` (unlike the pages' translatedFrom):
		// the source is always the top-level English fields. Absent on
		// pre-tracking overlays — the dashboard surfaces those as "unknown"
		// rather than guessing fresh/stale. The tracked unit is the whole
		// overlay: per-field outdatedness would need per-field hashes; the
		// pragmatic unit is the source text as a whole. The metadata form
		// never round-trips `translations`, so a source edit can't clobber
		// this stamp.
		translatedFrom: z
			.object({
				hash: z.string(),
			})
			.optional(),
	}),
);

export type GameMetadataTranslations = z.output<typeof gameMetadataTranslationsSchema>;

// Per-language translations of the engine-defined option/setting/preference/
// expansion LABELS (#306 follow-up). GAME-level (on the metadata doc, like
// `translations`) even though the labels themselves live on VERSION docs:
// version docs are replaced wholesale on engine-version uploads, so anything
// stored there would be wiped — while option/item NAMES are stable engine
// identifiers, which is what the inner record is keyed by:
//   "options.<name>", "options.<name>.items.<itemName>",
//   "settings.<name>", "preferences.<name>", … and "expansions.<name>".
// (Keys contain literal dots — fine as Mongo document VALUES since 3.6; they
// are only ever written whole-language, never addressed by dotted update path.)
// `translatedFrom.hash` is a content hash of the ENGLISH label the entry was
// translated from — per-STRING, unlike the metadata overlay's whole-overlay
// hash, because option labels change independently of each other across engine
// versions. An entry is OUTDATED when the current English label hashes
// differently. Like `translations`, deliberately NOT in GAME_METADATA_FIELDS
// and NOT picked onto `gameInfoSchema`: the api resolves the request language
// at merge time and serves the winning label in the regular
// options/settings/preferences/expansions slots, so clients stay unchanged.
export const gameOptionTranslationsSchema = z.record(
	z.string().regex(/^[a-z]{2,3}$/, "language keys must be base subtags (2–3 lowercase letters)"),
	z.record(
		z.string(),
		z.object({
			label: z.string(),
			translatedFrom: z
				.object({
					hash: z.string(),
				})
				.optional(),
		}),
	),
);

export type GameOptionTranslations = z.output<typeof gameOptionTranslationsSchema>;

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
	// Markdown credits shown on the boardgame page (#351). Game-level (who made the
	// game doesn't change with an engine version) — supersedes the #348 per-game
	// `<game>:credits` CMS pages, migrated here by migration 1.10.0.
	credits: z.string().optional(),
	// See gameMetadataTranslationsSchema above.
	translations: gameMetadataTranslationsSchema.optional(),
	// See gameOptionTranslationsSchema above.
	optionTranslations: gameOptionTranslationsSchema.optional(),
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
	// See gameMetaStatusSchema above. Optional so existing docs are unaffected.
	status: gameMetaStatusSchema.optional(),
	// Whole-game requests (#340, status "requested"/"beta"): who asked for the game.
	// Kept when the request enters beta — the requests page still attributes it.
	requestedBy: zObjectId().optional(),
	// Admin-managed opt-out of the requests page: a private implementation must
	// not show up as a beta game while it has no public version. The lifecycle
	// re-derive (version upsert/delete) pins unlisted games to "implemented" —
	// never "beta". Auto-set when a brand-new game is created from the admin
	// panel (no associated request), clearable from the admin game page.
	unlisted: z.boolean().optional(),
	// Linked NodeBB topic id (Comments & Feedback category) — stored/returned when
	// set; the actual topic creation is wired separately.
	forumTid: z.number().int().optional(),
	// Chat moderation: disables posting in this boardgame's PUBLIC chat room
	// (history stays readable; game chat between participants is unaffected).
	// Deliberately NOT in GAME_METADATA_FIELDS and not accepted by the metadata
	// form's PUT — it's a moderation flag, toggled only through the dedicated
	// site-admin route, so a stale metadata form can't clobber it (same
	// protection `translations`/`likeCount` rely on). Not translatable.
	chatDisabled: z.boolean().optional(),
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
	"credits",
	"links",
	"players",
	"needOwnership",
	"unlisted",
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
			credits: true,
			links: true,
			players: true,
			needOwnership: true,
			unlisted: true,
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
