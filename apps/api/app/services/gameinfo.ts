import type { GameMetadataDoc, GamePreferencesDoc, UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import type { PickDeep } from "type-fest";
import { colls } from "../config/db.ts";
import { mergeGameInfo } from "../models/gameinfo.ts";

// An archived version is never the "current" one: it stays readable (viewer
// served, old games replayable) but is excluded from every latest-public pick.
// The admin archive action already refuses to archive the current latest public
// version; this filter is defence-in-depth so an archived doc can never leak
// back in (e.g. after versions above it are deleted). The filter is applied to
// the public branch only — a private-grant version (access.maxVersion) stays
// reachable for its grantees, since archiving blocks on having no ongoing games.
const NOT_ARCHIVED = { "meta.archived": { $ne: true } } as const;

// Implemented games (with or without versions) are never on the requests page;
// "requested" (no version yet) and "beta" (versioned, nothing public) are.
// Typed wide (not `as const`) so `.includes(someStatus)` narrows without a cast.
export const REQUEST_STATUSES: readonly GameMetadataDoc["status"][] = ["requested", "beta"];

// The request-page bucket is derived, never stored piecemeal: a game is
// "requested" while it has no version doc, "beta" while none of its versions is
// publicly listed, and implemented (status cleared) as soon as one is. Re-stamped
// on every version upsert/delete so the metadata doc always matches reality —
// including when a game goes straight to public (no beta phase) or is first
// uploaded under a different id than the request's. Exception: `unlisted` games
// (admin-managed opt-out, e.g. private implementations) are pinned to
// "implemented" — they never show on the requests page.
export async function deriveGameMetaStatus(game: string): Promise<GameMetadataDoc["status"]> {
	const [hasPublicVersion, hasAnyVersion, metadata] = await Promise.all([
		colls.gameInfos.findOne({ "_id.game": game, public: true, ...NOT_ARCHIVED }, { projection: { _id: 1 } }),
		colls.gameInfos.findOne({ "_id.game": game }, { projection: { _id: 1 } }),
		colls.gameMetadatas.findOne({ _id: game }, { projection: { unlisted: 1 } }),
	]);
	if (metadata?.unlisted) {
		return "implemented";
	}
	if (hasPublicVersion) {
		return undefined;
	}
	return hasAnyVersion ? "beta" : "requested";
}

export async function lastAccessibleVersion(game: string, user?: WithId<UserDoc>) {
	const versionDocPromise = (async () => {
		if (!user) {
			return colls.gameInfos.findOne(
				{ "_id.game": game, public: true, ...NOT_ARCHIVED },
				{ sort: { "_id.version": -1 } },
			);
		}

		const pref = await colls.gamePreferences.findOne<PickDeep<GamePreferencesDoc, "access.maxVersion">>(
			{ user: user._id, game, "access.maxVersion": { $exists: true } },
			{ projection: { "access.maxVersion": 1 } },
		);

		if (pref) {
			return colls.gameInfos.findOne(
				{
					"_id.game": game,
					$or: [{ public: true, ...NOT_ARCHIVED }, { "_id.version": pref.access!.maxVersion }],
				},
				{ sort: { "_id.version": -1 } },
			);
		}
		return colls.gameInfos.findOne(
			{ "_id.game": game, public: true, ...NOT_ARCHIVED },
			{ sort: { "_id.version": -1 } },
		);
	})();

	const [versionDoc, metadata] = await Promise.all([
		versionDocPromise,
		// Requested games (#340) have no version yet and are not playable games:
		// they must 404 on every game-info route. Beta games DO have versions and
		// pass here — reachability is governed by the versionDoc pick above
		// (nothing public → only access.maxVersion grantees get a doc back).
		colls.gameMetadatas.findOne({ _id: game, status: { $ne: "requested" } }),
	]);
	return mergeGameInfo(versionDoc, metadata);
}

export async function latestAccessibleGames<T>(userId?: T) {
	const ownGames = userId
		? await colls.gamePreferences
				.find({ user: userId, "access.maxVersion": { $exists: true } })
				.project<PickDeep<GamePreferencesDoc, "game" | "access.maxVersion">>({ game: 1, "access.maxVersion": 1 })
				.toArray()
		: [];
	const publicGames = await colls.gameInfos
		.aggregate<{
			_id: string;
			version: number;
		}>([
			{ $match: { public: true, ...NOT_ARCHIVED } },
			{ $sort: { "_id.game": 1, "_id.version": -1 } },
			{ $project: { _id: 1 } },
			{ $group: { _id: "$_id.game", version: { $first: "$_id.version" } } },
		])
		.toArray();

	const map = new Map<string, number>();

	for (const game of ownGames) {
		map.set(game.game, game.access!.maxVersion!);
	}

	for (const game of publicGames) {
		if (!map.has(game._id) || map.get(game._id)! < game.version) {
			map.set(game._id, game.version);
		}
	}

	return map;
}
