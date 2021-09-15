<script setup lang="ts">
import { ref, watch } from "vue-demi";
import { handleError, handleInfo } from "../utils";
import VCard from "~cdk/VCard.vue";
import { deleteApi, get, post } from "~/api/rest";
import { filesize } from "~/filters";

const serverInfo = ref<{ disk: { free: number; size: number }; nbUsers: number; announcement: string } | null>(null);
const email = ref("");
const username = ref("");
const gameId = ref("");
const gameIds = ref("");
const announcement = ref("");

get("/admin/serverinfo").then(data => serverInfo.value = data, handleError);

function resend(email: string) {
  post("/admin/resend-confirmation", { email }).then(info => handleInfo("Email sent!"), handleError);
}

function invite(email: string) {
  post("/admin/invite", { email }).then(info => handleInfo("Invite sent!"), handleError);
}

function deleteGame(gameId: string) {
  deleteApi(`/game/${gameId}`).then(() => handleInfo("Game deleted!"), handleError);
}

function replayGame(gameId: string) {
  post(`/gameplay/${gameId}/replay`, {}).then(() => handleInfo("Game replayed."), handleError);
}

function replayGames() {
  handleInfo("Batch replay started");
  post(`/gameplay/batch/replay`, { gameIds: gameIds.value.split("\n").map(x => x.trim()) })
    .then(info => handleInfo(`Games replayed: ${info.success}`), handleError);
}

function loadReplays() {
  handleInfo("Loading replays");
  post("/admin/load-games", { path: "/root/replay" });
}

function redoKarma(username: string) {
  post("/admin/compute-karma", { username }).then(() => handleInfo("Karma computed"), handleError);
}

function recomputeAllKarma() {
  post("/admin/compute-all-karma", {}).then(() => handleInfo("Karma computed"), handleError);
}

function recreate() {
  post("/admin/recreate-notifications", {})
    .then(resp => handleInfo(`${resp.length} game notifications created`), handleError);
}

function updateAnnouncement() {
  post("/admin/announcement", { announcement: announcement.value })
    .then(() => handleInfo("Announcement updated"), handleError);
}

watch(serverInfo, (serverInfo) => {
  if (serverInfo?.announcement) {
    announcement.value = serverInfo.announcement;
  }
});
</script>

<template>
  <div class="grid grid-flow-row-dense grid-cols-2 gap-4">
    <v-card :loading="!serverInfo">
      <template #title> Server info </template>
      <template v-if="serverInfo">
        Available space: {{ filesize(serverInfo.disk.free) }} / {{ filesize(serverInfo.disk.size) }} <br />
        Users: {{ serverInfo.nbUsers }} <br />

        <v-textarea v-model="announcement"></v-textarea>
      </template>
      <template #actions>
        <v-btn color="primary" @click="updateAnnouncement"> Update </v-btn>
      </template>
    </v-card>

    <v-card>
      <template #title> Game management </template>
      <v-text-field v-model="gameId" label="Game ID" />
      <template #actions>
        <v-btn @click="replayGame(gameId)"> Replay </v-btn>
        <v-btn class="bg-red-600" @click="deleteGame(gameId)"> Delete </v-btn>
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
      <template #title> Email management </template>
      <v-text-field v-model="email" label="Email" type="email" />
      <template #actions>
        <v-btn @click="invite(email)"> Invite </v-btn>
      </template>
    </v-card>
  </div>
</template>
