import { type GameLikeDoc } from "@bgs/models";
import type { ObjectId } from "mongodb";
import { colls } from "../config/db.ts";

const DUPLICATE_KEY = 11000;

/** Games the user has liked. */
export async function likedGameIds(userId: ObjectId): Promise<Set<string>> {
	const likes = await colls.gameLikes.find({ user: userId }, { projection: { game: 1 } }).toArray();
	return new Set(likes.map((like) => like.game));
}

/**
 * Idempotent like/unlike. The denormalized `gameMetadatas.likeCount` (a single doc
 * per game since the #298 metadata split — a like targets the game, not a version)
 * is $inc-ed in the same write as the `gamelikes` doc, so the counter can't drift
 * from a retried request (the second write is a no-op).
 */
export async function setGameLike(
	game: string,
	userId: ObjectId,
	liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
	let delta = 0;

	if (liked) {
		const doc: GameLikeDoc = { game, user: userId, createdAt: new Date() };
		try {
			await colls.gameLikes.insertOne(doc);
			delta = 1;
		} catch (err) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
			if ((err as { code?: number })?.code !== DUPLICATE_KEY) {
				throw err;
			}
		}
	} else {
		const { deletedCount } = await colls.gameLikes.deleteOne({ game, user: userId });
		delta = -deletedCount;
	}

	const updated =
		delta === 0
			? await colls.gameMetadatas.findOne({ _id: game }, { projection: { likeCount: 1 } })
			: await colls.gameMetadatas.findOneAndUpdate(
					{ _id: game },
					{ $inc: { likeCount: delta } },
					{ returnDocument: "after", projection: { likeCount: 1 } },
				);

	return { liked, likeCount: updated?.likeCount ?? 0 };
}
