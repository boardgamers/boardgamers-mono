<script lang="ts" setup>
import type { GameInfo } from "@shared/types/gameinfo";
import { ref, watch } from "vue-demi";
import { get, post } from "~/api/rest";
import { handleError, handleSuccess } from "~/utils";

const props = defineProps<{ game: string; version: string }>();
const gameInfo = ref<GameInfo|null>(null);
const loading = ref(true);

async function updateGame(info: GameInfo) {
  try {
    await post(`/admin/gameinfo/${info._id.game}/${info._id.version}`, info);
    gameInfo.value = info;
    handleSuccess("Game updated");
  }
  catch (err) {
    handleError(err);
  }
}

watch(() => [props.game, props.version], async () => {
  loading.value = true;
  try {
    gameInfo.value = await get(`/admin/gameinfo/${props.game}/${props.version}`);
  }
  catch (err) {
    handleError(err);
  }
  finally {
    loading.value = false;
  }
}, { immediate: true });
</script>
<template>
  <div>
    <h2 v-if="gameInfo">
      {{ gameInfo.label }} - version {{ gameInfo._id.version }}
    </h2>
    <game-edit v-if="gameInfo" :game-info="gameInfo" mode="edit" @update:game="updateGame($event)" />
  </div>
</template>
<route>
{
  name: "game"
}
</route>
