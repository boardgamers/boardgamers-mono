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

// NodeBB's `maximumTitleLength` default — keep the composed title (tag prefix
// included) under it.
const MAX_TOPIC_TITLE_LENGTH = 255;

/**
 * Compose the forum topic title: a bracketed kind tag (`[Site feedback]`,
 * `[<game label>]`, `[Game request]`) so the forum topic list is scannable at
 * a glance, then the request's own title, truncated to stay under NodeBB's
 * title limit. Forum-only — the stored request title never gets the prefix.
 */
export function composeTopicTitle(tag: string, title: string): string {
	const prefix = `[${tag}] `;
	const room = MAX_TOPIC_TITLE_LENGTH - prefix.length;
	return prefix + (title.length > room ? title.slice(0, room) : title);
}

export interface FeedbackTopic {
	tid: number;
	url: string;
}

/**
 * Bearer-token JSON call against the NodeBB Write API. Returns null on any failure.
 *
 * The token is a *master* token (uid 0): NodeBB rejects every call — reads
 * included — that doesn't say which user to act as
 * (`[[error:api.master-token-no-uid]]`, src/middleware/user.js). Callers pass
 * the acting `uid`: writes send it as `_uid` in the JSON body; GETs have no
 * body, so it is appended as a `?_uid=` query parameter instead (the
 * middleware accepts either).
 */
async function forumFetch(
	method: "GET" | "POST" | "PUT",
	path: string,
	payload?: Record<string, unknown>,
	uid?: number,
): Promise<unknown> {
	if (!env.forumWriteToken) {
		return null;
	}
	try {
		const url = `${env.forumUrl}${path}${uid !== undefined ? `${path.includes("?") ? "&" : "?"}_uid=${uid}` : ""}`;
		const res = await fetch(url, {
			method,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${env.forumWriteToken}`,
			},
			...(payload ? { body: JSON.stringify(payload) } : {}),
			signal: AbortSignal.timeout(FORUM_TIMEOUT_MS),
		});
		if (!res.ok) {
			console.warn(`[forum] ${method} ${path} failed: HTTP ${res.status}`);
			return null;
		}
		return await res.json();
	} catch (err) {
		console.warn(`[forum] ${method} ${path} failed:`, err instanceof Error ? err.message : err);
		return null;
	}
}

function writeApiResponse(data: unknown): Record<string, unknown> | null {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- NodeBB write-API response shape
	const payload = (data as { response?: unknown })?.response;
	if (typeof payload !== "object" || payload === null) {
		return null;
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- NodeBB write-API response shape
	return payload as Record<string, unknown>;
}

export interface ForumTopicInfo {
	title: string;
	mainPid: number;
	tags: string[];
}

/** Read a topic (title, main post id, tags) via the Write API; null when unreachable/deleted. */
export async function getForumTopic(tid: number): Promise<ForumTopicInfo | null> {
	const payload = writeApiResponse(await forumFetch("GET", `/api/v3/topics/${tid}`, undefined, env.forumWriteUid));
	if (typeof payload?.title !== "string" || typeof payload.mainPid !== "number") {
		return null;
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- NodeBB write-API response shape
	const tags = Array.isArray(payload.tags) ? (payload.tags as { value?: unknown }[]) : [];
	return {
		title: payload.title,
		mainPid: payload.mainPid,
		tags: tags.map((t) => t?.value).filter((v): v is string => typeof v === "string"),
	};
}

/**
 * Retitle a topic by editing its main post (the Write API accepts `title` on
 * main posts only) and replace its tags. The post content is re-sent
 * unchanged — the write API requires it and the API re-render would no-op.
 * Fail-safe: returns false (and logs) on any failure.
 */
export async function editForumTopic(input: {
	tid: number;
	mainPid: number;
	title: string;
	tags: string[];
}): Promise<boolean> {
	const uid = env.forumWriteUid;
	const post = writeApiResponse(await forumFetch("GET", `/api/v3/posts/${input.mainPid}`, undefined, uid));
	if (typeof post?.content !== "string") {
		console.warn(`[forum] could not read main post ${input.mainPid} of topic ${input.tid}`);
		return false;
	}
	const edited = await forumFetch("PUT", `/api/v3/posts/${input.mainPid}`, {
		content: post.content,
		title: input.title,
		_uid: uid,
	});
	if (edited === null) {
		return false;
	}
	// Replace the topic's tags: `PUT /api/v3/topics/:tid/tags` takes an array of
	// strings (write-api updateTags → Topics.updateTopicTags: delete + re-add).
	// Unknown tags are created on the fly — they only need to pass cleanUpTag
	// (trim/lowercase, strip [,/#!$^*;:{}=_`<>'"~()?|], 3+ chars).
	return (await forumFetch("PUT", `/api/v3/topics/${input.tid}/tags`, { tags: input.tags, _uid: uid })) !== null;
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
 * `_uid` impersonation. When absent, it is posted as the configured system uid
 * (`env.forumWriteUid`) — the token is a master token, so some `_uid` is always
 * required — with a "Requested by <username>" attribution line.
 */
export async function createFeedbackTopic(input: {
	title: string;
	tag: string;
	tags?: string[];
	body?: string;
	requestUrl: string;
	username: string;
	forumUid?: number;
}): Promise<FeedbackTopic | null> {
	const title = composeTopicTitle(input.tag, input.title);
	const lines = [
		...(input.body ? [input.body, ""] : []),
		`Requested by [${input.username}](https://${env.site}/user/${encodeURIComponent(input.username)}) on [boardgamers.space](${input.requestUrl}).`,
	];

	// `tags` is an array of strings — Topics.post stores `tags.join(',')` on the
	// topic and createTags registers each one; unknown tags are created on the
	// fly. `_uid` is the requester's forum uid when linked (posted AS them),
	// otherwise the configured system uid.
	const data = await forumFetch("POST", "/api/v3/topics", {
		cid: FEEDBACK_CATEGORY_ID,
		title,
		content: lines.join("\n\n"),
		...(input.tags?.length ? { tags: input.tags } : {}),
		_uid: input.forumUid ?? env.forumWriteUid,
	});
	if (data === null) {
		console.warn(`[forum] topic creation for "${title}" failed`);
		return null;
	}
	const payload = writeApiResponse(data);
	if (typeof payload?.tid !== "number") {
		console.warn(`[forum] topic creation for "${title}" returned no tid`);
		return null;
	}
	const slug = typeof payload.slug === "string" ? payload.slug : `topic/${payload.tid}`;
	return { tid: payload.tid, url: `${env.forumUrl}/${slug}` };
}
