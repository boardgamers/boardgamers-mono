import { z } from "zod";

// Browser-safe part of the chat-reactions model (#438): the web app imports
// this subpath directly — the @bgs/models root (and ./chatreaction.ts) pull
// mongodb in, which must stay out of the client bundle.

// Emoji a chat message can be reacted with. A fixed whitelist — not free-form
// graphemes — so the per-(message, user) storage in the reactions collection is
// strictly bounded and clients can render a picker without an emoji library.
// Order matters: the web picker shows them in this order.
export const CHAT_REACTION_EMOJI = [
	"👍",
	"👎",
	"❤️",
	"😂",
	"😮",
	"😢",
	"🎉",
	"👀",
	"🔥",
	"🤔",
	"👏",
	"🙏",
	"💯",
	"😅",
	"😴",
	"🤯",
	"🎲",
	"🏆",
	"⏳",
	"🍀",
] as const;

// The quick-react row shown before "more" expands to the full whitelist.
export const CHAT_REACTION_QUICK = ["👍", "❤️", "😂", "👀", "🎉"] as const;

// Max distinct emoji one user can have active on one message.
export const MAX_CHAT_REACTIONS_PER_MESSAGE = 5;

export const chatReactionEmojiSchema = z
	.string()
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readonly tuple → readonly string[] for .includes
	.refine((emoji) => (CHAT_REACTION_EMOJI as readonly string[]).includes(emoji), "Unsupported reaction emoji");

// Wire shape of one message's reactions, as served by the api and pushed over
// the websocket: per emoji, who reacted (insertion order). An empty `reactions`
// array means "this message has no active reactions anymore" — clients clear it.
export type ChatReactionAggregate = {
	message: string;
	reactions: { emoji: string; users: { _id: string; name: string }[] }[];
};
