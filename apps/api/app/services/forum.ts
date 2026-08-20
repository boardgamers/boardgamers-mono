import { type ObjectId, MongoClient } from "mongodb";
import env from "../config/env.ts";

// NodeBB Write API client (#340): every feedback/game request gets a discussion
// topic in the forum's "Comments & Feedback" category, linked both ways (the
// request stores the returned `forumTid`; the topic content links back to the
// request on the site). Commenting itself happens on the forum — users get a
// forum account lazily via BGS OAuth (nodebb-plugin-sso-oauth2-multiple) on
// their first forum login, so nothing is needed from them at request time.

// "Comments & Feedback" — confirmed with the maintainer in #340.
const FEEDBACK_CATEGORY_ID = 4;

// A slow forum must not hold up request creation — fail safe past this.
const FORUM_TIMEOUT_MS = 4000;

export interface FeedbackTopic {
	tid: number;
	url: string;
}

/**
 * The user's linked NodeBB forum uid, or null when they have no forum account
 * (or the forum db is unreachable). Reads the authoritative
 * `objects` doc `{ _key: "boardgamersId:uid" }` (bgs user ObjectId hex → forum
 * uid), the same map `cleanupDeadUsers` trusts — and then requires the mapped
 * `user:<uid>` doc to actually carry a username: a stale map entry (forum
 * account deleted while the entry survived) points at a ghost/partial user
 * that cannot post, so it must gate exactly like "no forum account" — the
 * re-link flow then heals the stale entry (see the sso-bgs plugin's
 * loginHealingStaleLink).
 *
 * Uses a short-lived dedicated connection (not the cached `nodebbColls`): this
 * runs on the request-creation hot path, and a self-contained connect/close per
 * call keeps a forum outage from poisoning the shared cached connection — and
 * keeps tests from having to mutate shared env. Fail-safe: any error → null.
 */
export async function forumUidForUser(userId: ObjectId): Promise<number | null> {
	let client: MongoClient | null = null;
	try {
		client = new MongoClient(env.database.nodebb, { directConnection: true, serverSelectionTimeoutMS: 3000 });
		await client.connect();
		const objects = client.db(client.options.dbName ?? "nodebb").collection("objects");
		const link = await objects.findOne({ _key: "boardgamersId:uid" }, { projection: { [userId.toHexString()]: 1 } });
		const uid = link?.[userId.toHexString()];
		const n = typeof uid === "string" ? Number(uid) : uid;
		if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
			return null;
		}
		const forumUser = await objects.findOne({ _key: `user:${n}` }, { projection: { username: 1 } });
		if (typeof forumUser?.username !== "string" || forumUser.username.length === 0) {
			console.warn(`[forum] stale forum link for user ${userId.toHexString()}: uid ${n} has no username`);
			return null;
		}
		return n;
	} catch (err) {
		console.warn("[forum] forum-uid lookup failed:", err instanceof Error ? err.message : err);
		return null;
	} finally {
		await client?.close().catch(() => {});
	}
}

/**
 * Create the forum topic for a request. Returns null (and logs) when the token
 * is unset, the forum is unreachable/slow, or the response is unusable. The
 * caller treats null as a hard failure — a request is only created once its
 * forum topic exists, so there is no topic-less fallback.
 *
 * When `forumUid` is set, the topic is posted AS that user via the Write API's
 * `_uid` impersonation (the server token must be allowed to impersonate). When
 * absent, the topic is posted by the token's own (bot) account with a
 * "Requested by <username>" attribution line.
 */
export async function createFeedbackTopic(input: {
	title: string;
	body?: string;
	requestUrl: string;
	username: string;
	forumUid?: number;
}): Promise<FeedbackTopic | null> {
	if (!env.forumWriteToken) {
		return null;
	}

	const lines = [
		...(input.body ? [input.body, ""] : []),
		`Requested by [${input.username}](https://${env.site}/user/${encodeURIComponent(input.username)}) on [boardgamers.space](${input.requestUrl}).`,
	];

	try {
		const res = await fetch(`${env.forumUrl}/api/v3/topics`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${env.forumWriteToken}`,
			},
			body: JSON.stringify({
				cid: FEEDBACK_CATEGORY_ID,
				title: input.title,
				content: lines.join("\n\n"),
				...(input.forumUid ? { _uid: input.forumUid } : {}),
			}),
			signal: AbortSignal.timeout(FORUM_TIMEOUT_MS),
		});
		if (!res.ok) {
			console.warn(`[forum] topic creation for "${input.title}" failed: HTTP ${res.status}`);
			return null;
		}
		const data: unknown = await res.json();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- NodeBB write-API response shape
		const payload = (data as { response?: { tid?: unknown; slug?: unknown } })?.response;
		if (typeof payload?.tid !== "number") {
			console.warn(`[forum] topic creation for "${input.title}" returned no tid`);
			return null;
		}
		const slug = typeof payload.slug === "string" ? payload.slug : `topic/${payload.tid}`;
		return { tid: payload.tid, url: `${env.forumUrl}/${slug}` };
	} catch (err) {
		console.warn(`[forum] topic creation for "${input.title}" failed:`, err instanceof Error ? err.message : err);
		return null;
	}
}
