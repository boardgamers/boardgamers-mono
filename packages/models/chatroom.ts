// Public (non-game) chat rooms (#91). Chat rooms are plain string ids: game chat
// uses the game id, public rooms use a reserved id from this allow-list. Kept
// mongodb-free so the web client can import it via the `@bgs/models/chatroom`
// subpath without pulling the driver into the browser bundle.

export const LOBBY_ROOM = "lobby";

// Single lobby room for now — adding an entry here (plus its UI entry point) is
// all it takes to open another public room (#49).
export const PUBLIC_CHAT_ROOMS: ReadonlySet<string> = new Set([LOBBY_ROOM]);

export function isPublicChatRoom(room: string): boolean {
	return PUBLIC_CHAT_ROOMS.has(room);
}
