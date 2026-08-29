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
