import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOBBY_ROOM, boardgameFromRoomId, boardgameRoomId, isPublicChatRoom } from "./chatroom.ts";

describe("public chat room ids", () => {
	it("round-trips boardgame room ids", () => {
		assert.strictEqual(boardgameRoomId("gaia-project"), "boardgame:gaia-project");
		assert.strictEqual(boardgameFromRoomId("boardgame:gaia-project"), "gaia-project");
	});

	it("rejects non-boardgame ids in boardgameFromRoomId", () => {
		assert.strictEqual(boardgameFromRoomId("boardgame:"), null);
		assert.strictEqual(boardgameFromRoomId(LOBBY_ROOM), null);
		assert.strictEqual(boardgameFromRoomId("some-game-id"), null);
	});

	it("shape-checks the public namespace (lobby + boardgame:*)", () => {
		assert.strictEqual(isPublicChatRoom(LOBBY_ROOM), true);
		assert.strictEqual(isPublicChatRoom("boardgame:container"), true);
		assert.strictEqual(isPublicChatRoom("boardgame:"), false);
		assert.strictEqual(isPublicChatRoom("some-game-id"), false);
	});
});
