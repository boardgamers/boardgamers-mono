import type { PlayerOrder } from "@bgs/types";

export const playerOrders = [
  { name: "random", label: "Random player order" },
  { name: "join", label: "Join order" },
  { name: "host", label: "Host decides order" },
] as const;

export function playerOrderText(playerOrder: PlayerOrder) {
  return playerOrders.find((p) => p.name === playerOrder)?.label;
}
