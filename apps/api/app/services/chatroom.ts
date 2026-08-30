// Server-side room validation (#91): which room ids the /api/room routes serve.
// The shape lives in @bgs/models/chatroom (shared with the web client); this adds
// the db-backed half. A boardgame room is accessible when:
//
//  - the boardgame has a public, non-archived version (the same "public" notion as
//    the /boardgame listing and deriveGameMetaStatus) — open to everyone, or
//  - the requesting user can access the boardgame anyway: a beta grant
//    (gamePreferences access.maxVersion) or admin — so testers can discuss a
//    pure-beta game in its room before any version goes public.
//
// One or two indexed findOnes per request are cheap enough at chat rates (posts
// are rate-limited) to skip caching.
import type { WithId } from "mongodb";
import { LOBBY_ROOM, boardgameFromRoomId, type UserDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { isUserAdmin } from "../models/index.ts";

export async function canAccessChatRoom(room: string, user?: WithId<UserDoc> | null): Promise<boolean> {
	// Dormant site-wide lobby: valid room, no UI mounts it (see @bgs/models/chatroom).
	if (room === LOBBY_ROOM) {
		return true;
	}

	const boardgame = boardgameFromRoomId(room);
	if (!boardgame) {
		return false;
	}

	const publicVersion = await colls.gameInfos.findOne(
		{ "_id.game": boardgame, public: true, "meta.archived": { $ne: true } },
		{ projection: { _id: 1 } },
	);
	if (publicVersion) {
		return true;
	}

	// No public version: the room only exists for users who can access the
	// boardgame itself (beta grantees and admins) — and only if the boardgame has
	// at least one version, so an admin request can't open a room on any string.
	if (!user) {
		return false;
	}
	if (!isUserAdmin(user)) {
		const grant = await colls.gamePreferences.findOne(
			{ user: user._id, game: boardgame, "access.maxVersion": { $exists: true } },
			{ projection: { _id: 1 } },
		);
		if (!grant) {
			return false;
		}
	}
	return !!(await colls.gameInfos.findOne({ "_id.game": boardgame }, { projection: { _id: 1 } }));
}
