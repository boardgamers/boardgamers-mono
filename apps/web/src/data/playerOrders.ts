import type { PlayerOrder } from "@bgs/models";
import { m } from "@/lib/i18n/messages";

/**
 * Player-order options for the new-game form. Labels are getters so they
 * resolve in the active UI language at render time (#306) — a language switch
 * re-labels the select without rebuilding the list.
 */
export const playerOrders = [
	{
		name: "random",
		get label() {
			return m.playerOrder_random();
		},
	},
	{
		name: "join",
		get label() {
			return m.playerOrder_join();
		},
	},
	{
		name: "host",
		get label() {
			return m.playerOrder_host();
		},
	},
] as const;

export function playerOrderText(playerOrder: PlayerOrder) {
	return playerOrders.find((p) => p.name === playerOrder)?.label;
}
