import type { ChatMessageFront } from "@bgs/models";
import { describe, expect, it } from "vitest";
import { countUnreadMessages } from "./chat";

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
