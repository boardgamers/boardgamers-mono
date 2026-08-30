// Subpath imports: the @bgs/models root pulls mongodb into the browser bundle.
import type { ChatMessageFront } from "@bgs/models/chatmessage";
import { isPublicChatRoom } from "@bgs/models/chatroom";
import { dateFromObjectId } from "./time";

/**
 * API base path of a chat room's routes: game rooms live under /game/:gameId,
 * public rooms (lobby, #91) under /room/:roomId. Both bases expose the same
 * /chat, /chat/:messageId, /chat/:messageId/reaction/:emoji and /chat/lastRead
 * sub-routes (see the api's chat-handlers.ts).
 */
export function chatApiBase(room: string): string {
	return isPublicChatRoom(room) ? `/room/${room}` : `/game/${room}`;
}

/**
 * Messages after `lastRead` the user hasn't seen — i.e. not authored by them.
 * The websocket echoes a user's own messages back to the room; without the author
 * check the sender would get an unread badge for their own message.
 */
export function countUnreadMessages(messages: ChatMessageFront[], lastRead: number, userId?: string): number {
	return messages.filter(
		(msg) =>
			msg.type !== "system" &&
			!!msg._id &&
			dateFromObjectId(msg._id).getTime() > lastRead &&
			(!userId || msg.author?._id !== userId),
	).length;
}

// Mirrors the API's edit window (PATCH /game/:gameId/chat/:messageId) — the UI hides
// the edit affordance where a PATCH would be rejected anyway.
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Whether the inline editor should be offered for this message. */
export function canEditMessage(message: ChatMessageFront, userId?: string, now = Date.now()): boolean {
	return (
		message.type === "text" &&
		!!message._id &&
		!!userId &&
		message.author?._id === userId &&
		now - dateFromObjectId(message._id).getTime() < CHAT_EDIT_WINDOW_MS
	);
}

/**
 * The message ArrowUp-in-an-empty-input should edit (Discord-style): the user's most
 * recent editable message, skipping the one already being edited (`editingId`).
 */
export function lastEditableMessage(
	messages: ChatMessageFront[],
	userId?: string,
	editingId?: string | null,
	now = Date.now(),
): ChatMessageFront | undefined {
	return messages.findLast((msg) => canEditMessage(msg, userId, now) && msg._id !== editingId);
}

export type ChatScrollState = { lastId: string | undefined; open: boolean };

/**
 * Whether a chat update should force-scroll the message list to the bottom:
 * first render, the chat (re)opening, or a new message landing at the end.
 * In-place updates keep the same trailing id — edits re-pushed by the ws —
 * and must NOT yank the view down while the user reads history.
 */
export function shouldScrollChatToBottom(prev: ChatScrollState | undefined, next: ChatScrollState): boolean {
	return !prev || prev.lastId !== next.lastId || (next.open && !prev.open);
}

// Sub-pixel scroll positions (zoom, fractional row heights) leave scrollTop a
// hair short of the exact maximum — treat "almost at the bottom" as pinned.
const PINNED_TOLERANCE_PX = 8;

/**
 * Whether a scrollable chat container is effectively scrolled to the bottom,
 * i.e. the view should stay anchored there when its content grows.
 */
export function isPinnedToBottom(el: Pick<Element, "scrollTop" | "clientHeight" | "scrollHeight">): boolean {
	return el.scrollTop + el.clientHeight >= el.scrollHeight - PINNED_TOLERANCE_PX;
}
