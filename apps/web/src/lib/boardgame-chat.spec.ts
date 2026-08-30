import { describe, expect, it } from "vitest";
import { chatRoomAccessible } from "./boardgame-chat";

describe("chatRoomAccessible (per-boardgame chat FAB)", () => {
	it("shows the room when any listed version is public — not just the picked-latest", () => {
		// Beta grantee on a mixed game: their latest-accessible version is private,
		// but an older public version keeps the room open (same collapse as #427).
		expect(chatRoomAccessible([{ public: false }, { public: true }], true)).toBe(true);
		expect(chatRoomAccessible([{ public: true }], false)).toBe(true);
	});

	it("shows a fully-private boardgame's room to logged-in users who can see a version (beta grant)", () => {
		expect(chatRoomAccessible([{ public: false }], true)).toBe(true);
	});

	it("hides the room when logged out and no version is public", () => {
		expect(chatRoomAccessible([{ public: false }], false)).toBe(false);
		expect(chatRoomAccessible([{}], false)).toBe(false);
	});

	it("hides the room when the user can't see any version", () => {
		expect(chatRoomAccessible([], true)).toBe(false);
		expect(chatRoomAccessible([], false)).toBe(false);
	});
});
