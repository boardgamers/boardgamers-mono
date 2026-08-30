// Public (non-game) chat rooms (#91). Chat rooms are plain string ids: game chat
// uses the game id, public rooms use a namespaced id that a game id can never
// collide with ("boardgame:<slug>" — game ids match /^[A-Za-z0-9_-]+$/, no ":").
// Kept mongodb-free so the web client can import it via the `@bgs/models/chatroom`
// subpath without pulling the driver into the browser bundle.

// Dormant site-wide room: valid server-side, but no UI mounts it — reviving it is
// one `<ChatRoom room={LOBBY_ROOM} corner />` mount away.
export const LOBBY_ROOM = "lobby";

// One public room per boardgame with a public version, e.g. "boardgame:gaia-project".
export const BOARDGAME_ROOM_PREFIX = "boardgame:";

export function boardgameRoomId(boardgame: string): string {
	return BOARDGAME_ROOM_PREFIX + boardgame;
}

/** The boardgame slug of a boardgame room id, or null for any other room id. */
export function boardgameFromRoomId(room: string): string | null {
	if (!room.startsWith(BOARDGAME_ROOM_PREFIX)) {
		return null;
	}
	const boardgame = room.slice(BOARDGAME_ROOM_PREFIX.length);
	return boardgame.length > 0 ? boardgame : null;
}

/**
 * SHAPE-level check: is this room id in the public-room namespace (the lobby, or
 * any "boardgame:<slug>")? The client uses it to route chat calls to /room/*
 * instead of /game/*. It deliberately does NOT know whether the boardgame exists
 * or has a public version — that's the api's job (services/chatroom.ts), checked
 * against the db on every /room request.
 */
export function isPublicChatRoom(room: string): boolean {
	return room === LOBBY_ROOM || boardgameFromRoomId(room) !== null;
}
