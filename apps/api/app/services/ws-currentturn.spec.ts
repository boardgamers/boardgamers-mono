import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { before, describe, it } from "node:test";
import { colls } from "../config/db.ts";
import { testGame, testUser } from "../config/test-helpers.ts";
import { sendActiveGames, sendCurrentTurnIds, type CurrentTurnSocket } from "./ws-currentturn.ts";

function fakeSocket(user?: ObjectId | null) {
	const sent: string[] = [];
	const ws: CurrentTurnSocket = {
		user,
		send: (data) => {
			sent.push(data);
		},
	};
	return { ws, sent };
}

describe("sendCurrentTurnIds", () => {
	it("pushes on first list and on change, skips an identical re-push", () => {
		const { ws, sent } = fakeSocket();

		assert.equal(sendCurrentTurnIds(ws, ["a", "b"]), true);
		assert.equal(sendCurrentTurnIds(ws, ["a", "b"]), false, "unchanged ids should not be re-sent");
		assert.equal(sent.length, 1);
		assert.deepEqual(JSON.parse(sent[0]), { command: "games:currentTurn", games: ["a", "b"] });

		assert.equal(sendCurrentTurnIds(ws, ["a"]), true, "a change must be pushed");
		assert.equal(sent.length, 2);
	});

	it("compares the id set order-insensitively", () => {
		const { ws, sent } = fakeSocket();

		sendCurrentTurnIds(ws, ["a", "b"]);
		assert.equal(sendCurrentTurnIds(ws, ["b", "a"]), false);
		assert.equal(sent.length, 1);
	});

	it("pushes the initial empty list once, then skips it", () => {
		const { ws, sent } = fakeSocket();

		assert.equal(sendCurrentTurnIds(ws, []), true);
		assert.equal(sendCurrentTurnIds(ws, []), false);
		assert.equal(sent.length, 1);
	});

	it("tracks each socket independently", () => {
		const a = fakeSocket();
		const b = fakeSocket();

		sendCurrentTurnIds(a.ws, ["game1"]);
		// A different socket has no last-sent key: it must receive the list even when
		// identical to another socket's.
		assert.equal(sendCurrentTurnIds(b.ws, ["game1"]), true);
		assert.equal(a.sent.length, 1);
		assert.equal(b.sent.length, 1);
	});
});

describe("sendActiveGames", () => {
	const user = testUser();
	const other = testUser();

	before(async () => {
		await colls.users.insertMany([user, other]);
	});

	it("sends nothing for an anonymous socket", async () => {
		const { ws, sent } = fakeSocket(null);
		await sendActiveGames(ws);
		assert.equal(sent.length, 0);
	});

	it("re-sends on a real turn change but not on repeat queries", async () => {
		const { ws, sent } = fakeSocket(user._id);
		const gameId = new ObjectId().toString();

		// First poll: it's `user`'s turn → one push with the game.
		await colls.games.insertOne(
			testGame({
				_id: gameId,
				game: { name: "test-game", version: 1 },
				status: "active",
				players: [{ _id: user._id }, { _id: other._id }],
				currentPlayers: [{ _id: user._id }],
			}),
		);
		await sendActiveGames(ws);
		assert.equal(sent.length, 1);
		assert.deepEqual(JSON.parse(sent[0]), { command: "games:currentTurn", games: [gameId] });

		// Second poll, nothing changed → no re-send.
		await sendActiveGames(ws);
		assert.equal(sent.length, 1, "unchanged turn-set must not be re-sent");

		// Turn passes to the other player → the list is now empty → one push.
		await colls.games.updateOne({ _id: gameId }, { $set: { currentPlayers: [{ _id: other._id }] } });
		await sendActiveGames(ws);
		assert.equal(sent.length, 2, "a real change must be pushed");
		assert.deepEqual(JSON.parse(sent[1]), { command: "games:currentTurn", games: [] });

		// Stable again → nothing.
		await sendActiveGames(ws);
		assert.equal(sent.length, 2);
	});
});
