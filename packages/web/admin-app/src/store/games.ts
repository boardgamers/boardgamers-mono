import { GameInfo } from "@bgs/types";
import { defineStore } from "pinia";
import { ref } from "vue-demi";

export const useGameStore = defineStore("games", () => {
  /**
   * Current named of the user.
   */
  const games = ref<GameInfo[]>([]);

  return {
    games,
  };
});
