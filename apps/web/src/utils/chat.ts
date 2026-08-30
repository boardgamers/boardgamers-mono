import type { ChatMessageFront } from "@bgs/models";
import { dateFromObjectId } from "./time";

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
