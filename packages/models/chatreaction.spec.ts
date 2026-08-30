import assert from "node:assert";
import { describe, it } from "node:test";
import {
	CHAT_REACTION_EMOJI,
	CHAT_REACTION_QUICK,
	chatReactionEmojiSchema,
	MAX_CHAT_REACTIONS_PER_MESSAGE,
} from "./chatreaction-emoji.ts";

describe("chatReactionEmojiSchema", () => {
	it("accepts every whitelisted emoji", () => {
		for (const emoji of CHAT_REACTION_EMOJI) {
			assert.strictEqual(chatReactionEmojiSchema.safeParse(emoji).success, true, emoji);
		}
	});

	it("rejects anything outside the whitelist", () => {
		for (const value of ["", "x", "thumbs-up", "👍👍", "👍 ", "💊", "<script>"]) {
			assert.strictEqual(chatReactionEmojiSchema.safeParse(value).success, false, value);
		}
	});

	it("keeps the quick-react set inside the whitelist", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readonly tuple → readonly string[] for .includes
		const all = CHAT_REACTION_EMOJI as readonly string[];
		for (const emoji of CHAT_REACTION_QUICK) {
			assert.ok(all.includes(emoji), emoji);
		}
		assert.ok(CHAT_REACTION_QUICK.length <= MAX_CHAT_REACTIONS_PER_MESSAGE);
	});
});
