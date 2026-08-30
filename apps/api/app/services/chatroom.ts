// Server-side public-room validation (#91): which room ids the /api/room routes
// serve. The shape lives in @bgs/models/chatroom (shared with the web client);
// this adds the db-backed half — a boardgame room only exists while its
// boardgame has a public, non-archived version (the same "public" notion as the
// /boardgame listing and deriveGameMetaStatus). One indexed findOne per request
// is cheap enough at chat rates (posts are rate-limited) to skip caching.
import { LOBBY_ROOM, boardgameFromRoomId } from "@bgs/models";
import { colls } from "../config/db.ts";

export async function isOpenPublicChatRoom(room: string): Promise<boolean> {
	// Dormant site-wide lobby: valid room, no UI mounts it (see @bgs/models/chatroom).
	if (room === LOBBY_ROOM) {
		return true;
	}

	const boardgame = boardgameFromRoomId(room);
	if (!boardgame) {
		return false;
	}

	return !!(await colls.gameInfos.findOne(
		{ "_id.game": boardgame, public: true, "meta.archived": { $ne: true } },
		{ projection: { _id: 1 } },
	));
}
