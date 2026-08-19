import { type FeedbackRequestLikeDoc } from "@bgs/models";
import type { ObjectId } from "mongodb";
import { colls } from "../config/db.ts";

const DUPLICATE_KEY = 11000;

/** Feedback requests the user has voted for. */
export async function likedFeedbackRequestIds(userId: ObjectId): Promise<Set<string>> {
	const likes = await colls.feedbackRequestLikes.find({ user: userId }, { projection: { request: 1 } }).toArray();
	return new Set(likes.map((like) => like.request.toHexString()));
}

/**
 * Idempotent like/unlike, mirroring gamelike.ts: the denormalized
 * `feedbackRequests.likeCount` is $inc-ed in the same write as the
 * `feedbackRequestLikes` doc, so the counter can't drift from a retried request
 * (the second write is a no-op).
 */
export async function setFeedbackRequestLike(
	request: ObjectId,
	userId: ObjectId,
	liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
	let delta = 0;

	if (liked) {
		const doc: FeedbackRequestLikeDoc = { request, user: userId, createdAt: new Date() };
		try {
			await colls.feedbackRequestLikes.insertOne(doc);
			delta = 1;
		} catch (err) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
			if ((err as { code?: number })?.code !== DUPLICATE_KEY) {
				throw err;
			}
		}
	} else {
		const { deletedCount } = await colls.feedbackRequestLikes.deleteOne({ request, user: userId });
		delta = -deletedCount;
	}

	const updated =
		delta === 0
			? await colls.feedbackRequests.findOne({ _id: request }, { projection: { likeCount: 1 } })
			: await colls.feedbackRequests.findOneAndUpdate(
					{ _id: request },
					{ $inc: { likeCount: delta } },
					{ returnDocument: "after", projection: { likeCount: 1 } },
				);

	return { liked, likeCount: updated?.likeCount ?? 0 };
}
