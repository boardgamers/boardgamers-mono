import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { composeTopicTitle, editForumTopic, getForumTopic } from "../../services/forum.ts";
import type { Migration } from "./index.ts";

// Forum topics created before the bracketed kind prefix ([Site feedback] /
// [<game label>] / [Game request]) and forum tags are brought in line: retitle
// (via a main-post edit — the Write API has no direct topic-title endpoint) and
// set the tags. Idempotent (a topic whose title already carries the expected
// prefix is skipped) and best-effort (an unreachable/deleted topic is logged
// and skipped, one topic at a time) — the remaining failures are picked up on
// the next re-run.

const SITE_FEEDBACK_TAG = "Site feedback";
const GAME_REQUEST_TAG = "Game request";

async function retitle(
	tid: number,
	tag: string,
	rawTitle: string,
	tags: string[],
): Promise<"updated" | "skipped" | "failed"> {
	const expected = composeTopicTitle(tag, rawTitle);
	const topic = await getForumTopic(tid);
	if (!topic) {
		console.warn(`prefix-forum-topic-titles: topic ${tid} unreadable (forum down or topic deleted), skipping`);
		return "failed";
	}
	if (topic.title.startsWith(`[${tag}] `)) {
		console.log(`prefix-forum-topic-titles: topic ${tid} already prefixed ("${topic.title}"), skipping`);
		return "skipped";
	}
	const ok = await editForumTopic({ tid, mainPid: topic.mainPid, title: expected, tags });
	if (!ok) {
		console.warn(`prefix-forum-topic-titles: could not update topic ${tid} ("${topic.title}")`);
		return "failed";
	}
	console.log(`prefix-forum-topic-titles: topic ${tid} "${topic.title}" → "${expected}"`);
	return "updated";
}

export const migration: Migration = {
	async up() {
		if (!env.forumWriteToken) {
			console.warn("prefix-forum-topic-titles: no forum write token configured, skipping");
			return;
		}

		const counts = { updated: 0, skipped: 0, failed: 0 };
		const track = async (tid: number, tag: string, rawTitle: string, tags: string[]) => {
			counts[await retitle(tid, tag, rawTitle, tags)]++;
		};

		const requests = await colls.feedbackRequests
			.find({ forumTid: { $exists: true } }, { projection: { kind: 1, game: 1, title: 1, forumTid: 1 } })
			.toArray();
		// Labels for game-specific feedback, derived the same way the create route does.
		const gameSlugs = [...new Set(requests.map((r) => r.game).filter((g): g is string => typeof g === "string"))];
		const labels = new Map(
			(await colls.gameMetadatas.find({ _id: { $in: gameSlugs } }, { projection: { label: 1 } }).toArray()).map((m) => [
				m._id,
				m.label,
			]),
		);
		for (const request of requests) {
			if (request.kind === "game" && request.game) {
				await track(request.forumTid!, labels.get(request.game) ?? request.game, request.title, [request.game]);
			} else {
				await track(request.forumTid!, SITE_FEEDBACK_TAG, request.title, ["site-feedback"]);
			}
		}

		const gameRequests = await colls.gameMetadatas
			.find({ status: "requested", forumTid: { $exists: true } }, { projection: { label: 1, forumTid: 1 } })
			.toArray();
		for (const request of gameRequests) {
			await track(request.forumTid!, GAME_REQUEST_TAG, request.label, ["game-request"]);
		}

		console.log(
			`prefix-forum-topic-titles: ${counts.updated} topic(s) retitled, ${counts.skipped} already prefixed, ${counts.failed} failed`,
		);
	},
};
