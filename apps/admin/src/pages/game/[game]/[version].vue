<script lang="ts" setup>
import type { GameInfo } from "@bgs/types";
import { ref, watch } from "vue-demi";
import { get, post } from "~/api/rest";
import { handleError, handleSuccess } from "~/utils";

const props = defineProps<{ game: string; version: string }>();
const gameInfo = ref<GameInfo | null>(null);
const loading = ref(true);

async function save() {
  try {
    await post(`/admin/gameinfo/${gameInfo.value!._id.game}/${gameInfo.value!._id.version}`, gameInfo.value!);
    handleSuccess("Game updated");
  } catch (err) {
    handleError(err);
  }
}

async function onDelete() {}

watch(
  () => [props.game, props.version],
  async () => {
    loading.value = true;
    try {
      gameInfo.value = await get(`/admin/gameinfo/${props.game}/${props.version}`);
    } catch (err) {
      handleError(err);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);
</script>
<template>
  <div>
    <h2 v-if="gameInfo">{{ gameInfo.label }} - version {{ gameInfo._id.version }}</h2>
    <game-edit v-if="gameInfo" v-model="gameInfo" mode="edit" @save="save" @delete="onDelete" />
  </div>
</template>
<route>
{
  name: "game"
}
</route>
