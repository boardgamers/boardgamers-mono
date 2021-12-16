<script setup lang="ts">
import { useRouter } from "vue-router";
import type { GameInfo } from "../../types";
import { handleError, handleSuccess } from "../../utils";
import { post, get } from "~/api/rest";
import { useGameStore } from "~/store/games";

const gamesStore = useGameStore();
const router = useRouter();
const game = ref<GameInfo | undefined>();

async function updateGame(gameInfo: GameInfo) {
  try {
    await post(`/admin/gameinfo/${gameInfo._id.game}/${gameInfo._id.version}`, gameInfo);
    handleSuccess("Game created");

    gamesStore.$patch({ games: await get("/admin/gameinfo") });
    router.push(`/game/${gameInfo._id.game}/${gameInfo._id.version}`);
  } catch (err) {
    handleError(err);
  }
}
</script>
<template>
  <div>
    <h2>New game</h2>
    <game-edit v-model="game" mode="new" @save="updateGame($event)" />
  </div>
</template>
