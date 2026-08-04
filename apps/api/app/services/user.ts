import { subDays } from "date-fns";
import type { ObjectId } from "mongodb";
import { type Filter } from "mongodb";
import type { UserDoc } from "@bgs/models";
import env from "../config/env.ts";
import { colls } from "../config/db.ts";

const ACTIVITY_FIELDS = ["security.lastActive", "security.lastLogin.date", "security.lastOnline"] as const;

// Conservative candidate pre-filter: very old account, no recorded activity of any kind
// after the cutoff (or none at all), never an admin. The per-user activity checks below
// (games, chat, …) run on top of this before anything is deleted.
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

export async function findDeadUsers(cutoff: Date, batchSize: number): Promise<UserDoc[]> {
	const candidates = await colls.users.find(deadUserCandidateFilter(cutoff)).sort({ createdAt: 1 }).toArray();

	const dead: UserDoc[] = [];
	for (const user of candidates) {
		if (dead.length >= batchSize) {
			break;
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

	const cutoff = subDays(Date.now(), env.cleanupDeadUsersMaxAgeDays);
	const dead = await findDeadUsers(cutoff, env.cleanupDeadUsersBatchSize);

	if (dead.length === 0) {
		console.log(
			`[cleanupDeadUsers] ${env.cleanupDeadUsers} mode: no dead users found (cutoff ${cutoff.toISOString()})`,
		);
		return;
	}

	if (env.cleanupDeadUsers === "dry-run") {
		console.log(`[cleanupDeadUsers] dry-run: ${dead.length} user(s) would be deleted: ${dead.map(label).join(", ")}`);
		return;
	}

	for (const user of dead) {
		const userId = user._id!;
		// Re-verify right before deleting: a user who joined their first game or posted
		// their first message between selection and now must be kept.
		if (await hasActivity(userId)) {
			console.log(`[cleanupDeadUsers] skipping ${label(user)}: activity appeared since selection`);
			continue;
		}
		// Same cleanup as the admin "delete user" route: the user doc plus their now-useless
		// per-user records. Games and chat messages are untouched (other players' games
		// reference them) — selected users have none by definition.
		await Promise.all([
			colls.users.deleteOne({ _id: userId }),
			colls.jwtRefreshTokens.deleteMany({ user: userId }),
			colls.gamePreferences.deleteMany({ user: userId }),
			colls.apiErrors.deleteMany({ user: userId }),
			colls.gameNotifications.deleteMany({ user: userId }),
			colls.roomMetaData.deleteMany({ user: userId }),
		]);
		console.log(`[cleanupDeadUsers] deleted user ${label(user)}`);
	}
}
