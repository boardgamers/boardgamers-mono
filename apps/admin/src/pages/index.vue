<script setup lang="ts">
import { ref, watch } from "vue-demi";
import { pick } from "lodash";
import { handleError, handleInfo } from "../utils";
import VCard from "~cdk/VCard.vue";
import VTextarea from "~/components/cdk/VTextarea.vue";
import { deleteApi, get, post } from "~/api/rest";
import { filesize } from "~/filters";
import { useUserStore } from "~/store/user";

const user = useUserStore();

const serverInfo = ref<{
  disk: { free: number; size: number };
  nbUsers: number;
  announcement: { content: string; title: string };
} | null>(null);
const gameId = ref("");
const gameIds = ref("");
const json = ref("");
const to = ref(0);
const announcement = reactive({ title: "", content: "" });

watch(gameId, async (gameId) => {
  to.value = await get(`/gameplay/${gameId}/length`);
  json.value = JSON.stringify((await get(`/gameplay/${gameId}`)).data, null, 2);
});

get("/admin/serverinfo").then((data) => (serverInfo.value = data), handleError);

function deleteGame(gameId: string) {
  deleteApi(`/game/${gameId}`).then(() => handleInfo("Game deleted!"), handleError);
}

function replayGame(gameId: string, body: { to: number }) {
  post(`/gameplay/${gameId}/replay`, body).then(() => handleInfo("Game replayed."), handleError);
}

function saveJson(gameId: string, body: { json: string }) {
  if (!body.json.trim().length) {
    handleError(new Error("Body is empty"));
    return;
  }

  post(`/gameplay/${gameId}/edit-data`, { json: JSON.parse(body.json) }).then(
    () => handleInfo("Game saved. If the current player changed, don't forget to replay it."),
    handleError
  );
}

function replayGames() {
  handleInfo("Batch replay started");
  post(`/gameplay/batch/replay`, { gameIds: gameIds.value.split("\n").map((x) => x.trim()) }).then(
    (info) => handleInfo(`Games replayed: ${info.success}`),
    handleError
  );
}

function loadReplays() {
  handleInfo("Loading replays");
  post("/admin/load-games", { path: "/root/replay" });
}

function updateAnnouncement() {
  post("/admin/announcement", { announcement }).then(() => handleInfo("Announcement updated"), handleError);
}

watch(serverInfo, (serverInfo) => {
  if (serverInfo?.announcement) {
    Object.assign(announcement, pick(serverInfo.announcement, Object.keys(announcement)));
  }
});
</script>

<template>
  <div class="grid grid-flow-row-dense grid-cols-2 gap-4">
    <v-card :loading="!serverInfo">
      <template #title> Server info </template>
      <div v-if="serverInfo" class="flex-col flex h-full">
        <ul>
          <li>Available space: {{ filesize(serverInfo.disk.free) }} / {{ filesize(serverInfo.disk.size) }}</li>
          <li>Users: {{ serverInfo.nbUsers }}</li>
        </ul>
        <v-text-field v-model="announcement.title" label="Title"></v-text-field>
        <v-textarea v-model="announcement.content" label="Announcement" class="flex-grow"></v-textarea>
      </div>
      <template #actions>
        <v-btn color="primary" @click="updateAnnouncement"> Update </v-btn>
      </template>
    </v-card>

    <v-card>
      <template #title> Game management </template>
      <v-text-field v-model="gameId" label="Game ID" />
      <v-text-field type="number" v-model.number="to" label="To (number)" />
      <v-textarea label="JSON" v-model.trim="json" />
      <template #actions>
        <v-btn @click="replayGame(gameId, { to })"> Replay </v-btn>
        <v-btn @click="saveJson(gameId, { json })"> Save JSON </v-btn>
        <v-btn variant="error" @click="deleteGame(gameId)" class="ml-auto"> Delete </v-btn>
      </template>
    </v-card>

    <v-card>
      <template #title> Mass game management </template>
      <v-textarea v-model="gameIds" label="Game IDs" hint="Game ids separated by newlines" />
      <template #actions>
        <v-btn @click="replayGames()"> Mass replay </v-btn>
        <v-btn @click="loadReplays()"> Load replays </v-btn>
      </template>
    </v-card>

    <v-card>
      <template #title> Backups </template>
      <ul>
        <v-list-item
          :to="`/api/admin/backup/games?token=${encodeURIComponent(user.accessTokens.all?.code)}`"
          class="px-2"
          target="_blank"
        >
          Games
        </v-list-item>
      </ul>
    </v-card>
  </div>
</template>
