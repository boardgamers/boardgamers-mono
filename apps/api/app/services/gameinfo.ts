import type { UserDoc, GamePreferencesDoc } from "@bgs/models";
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
		// they must 404 on every game-info route.
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
