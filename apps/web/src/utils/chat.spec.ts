import type { ChatMessageFront } from "@bgs/models";
import { describe, expect, it } from "vitest";
import { CHAT_EDIT_WINDOW_MS, canEditMessage, countUnreadMessages, lastEditableMessage } from "./chat";

// ObjectId whose first 8 hex chars encode `seconds` — matches dateFromObjectId.
function objectIdAt(seconds: number): string {
	return seconds.toString(16).padStart(8, "0") + "a".repeat(16);
}

function msg(overrides: Partial<ChatMessageFront> & { at: number }): ChatMessageFront {
	const { at, ...rest } = overrides;
	return {
		_id: objectIdAt(at),
		room: "room",
		data: { text: "hi" },
		type: "text",
		...rest,
	};
}

describe("countUnreadMessages", () => {
	it("counts messages after lastRead", () => {
		const messages = [msg({ at: 100 }), msg({ at: 200 }), msg({ at: 300 })];
		expect(countUnreadMessages(messages, 150_000, "u1")).toBe(2);
	});

	it("never counts the current user's own messages", () => {
		const own = msg({ at: 200, author: { _id: "u1", name: "me" } });
		const other = msg({ at: 300, author: { _id: "u2", name: "them" } });
		expect(countUnreadMessages([own], 0, "u1")).toBe(0);
		expect(countUnreadMessages([own, other], 0, "u1")).toBe(1);
	});

	it("keeps counting all messages when logged out (no userId)", () => {
		const message = msg({ at: 200, author: { _id: "u1", name: "me" } });
		expect(countUnreadMessages([message], 0, undefined)).toBe(1);
	});

	it("ignores system messages and messages without an id", () => {
		const system = msg({ at: 200, type: "system" });
		const noId = { ...msg({ at: 200 }), _id: undefined };
		expect(countUnreadMessages([system, noId], 0, "u1")).toBe(0);
	});
});

// `now` pinned so the specs are deterministic; message ages are expressed against it.
const NOW_SECONDS = 1_800_000_000;
const NOW = NOW_SECONDS * 1000;

function ownMsg(secondsAgo: number, overrides: Partial<ChatMessageFront> = {}): ChatMessageFront {
	return msg({ at: NOW_SECONDS - secondsAgo, author: { _id: "u1", name: "me" }, ...overrides });
}

describe("canEditMessage", () => {
	it("allows own recent text messages only", () => {
		expect(canEditMessage(ownMsg(60), "u1", NOW)).toBe(true);
		expect(canEditMessage(ownMsg(60, { author: { _id: "u2", name: "them" } }), "u1", NOW)).toBe(false);
		expect(canEditMessage(ownMsg(60, { type: "emoji" }), "u1", NOW)).toBe(false);
		expect(canEditMessage(ownMsg(60, { type: "system", author: undefined }), "u1", NOW)).toBe(false);
		expect(canEditMessage({ ...ownMsg(60), _id: undefined }, "u1", NOW)).toBe(false);
	});

	it("rejects messages older than the edit window, and everything when logged out", () => {
		expect(canEditMessage(ownMsg(CHAT_EDIT_WINDOW_MS / 1000 + 60), "u1", NOW)).toBe(false);
		expect(canEditMessage(ownMsg(60), undefined, NOW)).toBe(false);
	});
});

describe("lastEditableMessage (ArrowUp edit-last)", () => {
	it("picks the most recent editable message, skipping foreign/non-text/expired ones", () => {
		const oldOwn = ownMsg(CHAT_EDIT_WINDOW_MS / 1000 + 60, { data: { text: "own but too old" } });
		const target = ownMsg(120, { data: { text: "own recent" } });
		const emoji = ownMsg(60, { type: "emoji", data: { text: "🎉" } });
		const foreign = ownMsg(30, { author: { _id: "u2", name: "them" }, data: { text: "someone else's" } });
		const system = ownMsg(10, { type: "system", author: undefined, data: { text: "system entry" } });

		expect(lastEditableMessage([oldOwn, target, emoji, foreign, system], "u1", null, NOW)).toBe(target);
	});

	it("skips the message already being edited", () => {
		const older = ownMsg(120, { data: { text: "older" } });
		const newest = ownMsg(30, { data: { text: "newest" } });
		expect(lastEditableMessage([older, newest], "u1", newest._id, NOW)).toBe(older);
	});

	it("returns undefined when nothing qualifies", () => {
		const foreign = ownMsg(60, { author: { _id: "u2", name: "them" } });
		const tooOld = ownMsg(CHAT_EDIT_WINDOW_MS / 1000 + 60);
		expect(lastEditableMessage([foreign, tooOld], "u1", null, NOW)).toBeUndefined();
		expect(lastEditableMessage([], "u1", null, NOW)).toBeUndefined();
	});
});
