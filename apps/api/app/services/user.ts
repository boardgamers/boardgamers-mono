import { subDays } from "date-fns";
import type { ObjectId } from "mongodb";
import { type Filter } from "mongodb";
import { z } from "zod";
import { SettingsKey, type UserDoc } from "@bgs/models";
import env from "../config/env.ts";
import { colls, nodebbColls } from "../config/db.ts";

export const CLEANUP_DEAD_USERS_INTERVAL_MS = 24 * 3600 * 1000;

// security.lastSeen is bumped both by the sliding-session middleware (mutating
// activity) and by OAuth authorize/token — so an SSO-only user is still "seen".
const ACTIVITY_FIELDS = [
	"security.lastActive",
	"security.lastLogin.date",
	"security.lastOnline",
	"security.lastSeen",
] as const;

// Conservative candidate pre-filter: very old account, no recorded activity of any kind
// after the cutoff (or none at all), never an admin. The per-user activity checks below
// (games, chat, …) run on top of this before anything is archived.
export function deadUserCandidateFilter(cutoff: Date): Filter<UserDoc> {
	return {
		createdAt: { $lt: cutoff },
		authority: { $ne: "admin" },
		$and: ACTIVITY_FIELDS.map((field) => ({
			$or: [{ [field]: null }, { [field]: { $exists: false } }, { [field]: { $lt: cutoff } }],
		})),
	};
}

function label(user: UserDoc): string {
	return `${String(user._id)} (${user.account.username})`;
}

async function hasActivity(userId: ObjectId): Promise<boolean> {
	const [games, createdGames, chatMessages, gameNotifications] = await Promise.all([
		colls.games.countDocuments({ "players._id": userId }, { limit: 1 }),
		colls.games.countDocuments({ creator: userId }, { limit: 1 }),
		colls.chatMessages.countDocuments({ "author._id": userId }, { limit: 1 }),
		colls.gameNotifications.countDocuments({ user: userId }, { limit: 1 }),
	]);
	return games > 0 || createdGames > 0 || chatMessages > 0 || gameNotifications > 0;
}

// Conservative backstop: a user with ANY oauthConsents doc authorized a client at
// least once, and a forum user always authorized at least once. Since we never
// delete on uncertainty, any OAuth trace is an unconditional keep — it guards
// against a forum-content lookup that missed (or a forum user whose only content
// predates our lookup). The content-based forum-posts check below is the real
// signal; this is the cheap fail-safe.
async function hasOAuthTrace(userIds: ObjectId[]): Promise<Set<string>> {
	if (userIds.length === 0) {
		return new Set();
	}
	const docs = await colls.oauthConsents.find({ userId: { $in: userIds } }, { projection: { userId: 1 } }).toArray();
	return new Set(docs.map((d) => d.userId.toString()));
}

/**
 * bgs user ids that have forum CONTENT (posts), looked up in the read-only NodeBB
 * db. The bgs→forum-uid map is NodeBB's `objects` doc `{ _key: "boardgamersId:uid",
 * "<bgsUserIdHex>": <forumUid> }`; posts live in the `uid:<forumUid>:posts` set.
 * Fail-safe: when the forum db is unreachable (or the lookup errors), return ALL
 * input ids — never delete on uncertainty.
 */
async function forumUsersWithContent(userIds: ObjectId[]): Promise<Set<string>> {
	const protected_ = new Set(userIds.map((id) => id.toString()));
	if (userIds.length === 0) {
		return protected_;
	}
	const nodebb = await nodebbColls();
	if (!nodebb) {
		return protected_;
	}
	try {
		const objects = nodebb.objects;
		// One hash doc maps every linked bgs user → forum uid.
		const link = await objects.findOne({ _key: "boardgamersId:uid" });
		const uidToBgs = new Map<string, string>();
		for (const id of userIds) {
			const forumUid = link?.[id.toHexString()];
			if (typeof forumUid === "number" || typeof forumUid === "string") {
				uidToBgs.set(String(forumUid), id.toHexString());
			}
		}
		if (uidToBgs.size === 0) {
			return new Set();
		}
		const uids = [...uidToBgs.keys()];
		const posting = await objects
			.find({ _key: { $in: uids.map((u) => `uid:${u}:posts`) } }, { projection: { _key: 1 } })
			.toArray();
		const result = new Set<string>();
		for (const doc of posting) {
			const forumUid = String(doc._key).slice("uid:".length, -":posts".length);
			const bgs = uidToBgs.get(forumUid);
			if (bgs) {
				result.add(bgs);
			}
		}
		return result;
	} catch (err) {
		console.error("[cleanupDeadUsers] forum-content lookup failed — failing safe (keep all)", err);
		return protected_;
	}
}

export async function findDeadUsers(cutoff: Date, batchSize: number): Promise<UserDoc[]> {
	const candidates = await colls.users.find(deadUserCandidateFilter(cutoff)).sort({ createdAt: 1 }).toArray();
	const ids = candidates.map((u) => u._id);
	// Batched up-front (no N+1): OAuth backstop + forum content.
	const oauthUsers = await hasOAuthTrace(ids);
	const forumUsers = await forumUsersWithContent(ids);

	const dead: UserDoc[] = [];
	for (const user of candidates) {
		if (dead.length >= batchSize) {
			break;
		}
		if (oauthUsers.has(user._id.toString()) || forumUsers.has(user._id.toString())) {
			continue;
		}
		if (!(await hasActivity(user._id))) {
			dead.push(user);
		}
	}
	return dead;
}

export async function cleanupDeadUsers() {
	if (env.cleanupDeadUsers === "off") {
		return;
	}

	// Deploy-resilient scheduling: a plain setInterval(24h) counts from process boot,
	// so frequent deploys would postpone the cleanup forever. Instead the last run is
	// persisted in settings and the cron ticks hourly (plus once on boot) — a missed
	// window catches up after a restart. Runs at most once per 24h.
	const lastRun = await colls.settings.findOne({ _id: SettingsKey.CleanupDeadUsersLastRun });
	const lastRunAt = new Date(z.string().optional().parse(lastRun?.value) ?? 0);
	if (Date.now() - lastRunAt.getTime() < CLEANUP_DEAD_USERS_INTERVAL_MS) {
		return;
	}

	// Stamped before the work: if the process dies mid-run, the next attempt is still
	// 24h later and this run's already-archived users stay archived (idempotent).
	await colls.settings.updateOne(
		{ _id: SettingsKey.CleanupDeadUsersLastRun },
		{ $set: { value: new Date().toISOString() } },
		{ upsert: true },
	);

	const cutoff = subDays(Date.now(), env.cleanupDeadUsersMaxAgeDays);
	const dead = await findDeadUsers(cutoff, env.cleanupDeadUsersBatchSize);

	if (dead.length === 0) {
		console.log(
			`[cleanupDeadUsers] ${env.cleanupDeadUsers} mode: no dead users found (cutoff ${cutoff.toISOString()})`,
		);
		return;
	}

	if (env.cleanupDeadUsers === "dry-run") {
		console.log(
			`[cleanupDeadUsers] dry-run: ${dead.length} user(s) would be archived to deletedUsers: ${dead.map(label).join(", ")}`,
		);
		return;
	}

	for (const user of dead) {
		const userId = user._id!;
		// Re-verify right before archiving: a user who joined their first game, posted
		// their first message, authorized a client, or has forum content between
		// selection and now must be kept. All checks fail safe toward keeping.
		if (
			(await hasOAuthTrace([userId])).size > 0 ||
			(await forumUsersWithContent([userId])).size > 0 ||
			(await hasActivity(userId))
		) {
			console.log(`[cleanupDeadUsers] skipping ${label(user)}: activity appeared since selection`);
			continue;
		}
		// Soft-delete: archive the full user doc into the deletedUsers collection before
		// removing it from users, so the account can be restored later. The original _id
		// is stored as `userId` (the archive gets a fresh _id — its _id_ index is always
		// unique, and a restored-then-re-archived user must not collide with the first
		// archived copy). Restore = re-insert the archived doc into users with
		// `_id: userId`, dropping `deletedAt`/`userId`. Their now-useless per-user
		// records (tokens, preferences, …) are deleted for real; games and chat messages
		// are untouched (other players' games reference them) — selected users have none
		// by definition.
		const { _id: _originalId, ...rest } = user;
		await colls.deletedUsers.insertOne({ ...rest, userId, deletedAt: new Date() });
		await Promise.all([
			colls.users.deleteOne({ _id: userId }),
			colls.jwtRefreshTokens.deleteMany({ user: userId }),
			colls.gamePreferences.deleteMany({ user: userId }),
			colls.apiErrors.deleteMany({ user: userId }),
			colls.gameNotifications.deleteMany({ user: userId }),
			colls.roomMetaData.deleteMany({ user: userId }),
		]);
		console.log(`[cleanupDeadUsers] archived user ${label(user)} to deletedUsers`);
	}
}
