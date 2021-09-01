<script setup lang="ts">

import { ref, watch } from "vue-demi";
import { handleError, handleInfo } from "../utils";
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
  <div>
    <v-row>
      <v-col cols="6">
        <v-card :loading="!serverInfo">
          <v-card-title>Server info</v-card-title>
          <v-card-text v-if="serverInfo">
            Available space: {{ filesize(serverInfo.disk.free) }} / {{ filesize(serverInfo.disk.size) }} <br />
            Users: {{ serverInfo.nbUsers }} <br />

            <v-textarea v-model="announcement"></v-textarea>
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="updateAnnouncement"> Update </v-btn>
          </v-card-actions>
        </v-card>

        <v-card class="mt-6">
          <v-card-title> Game management </v-card-title>
          <v-card-text>
            <v-text-field v-model="gameId" label="Game ID" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="replayGame(gameId)"> Replay </v-btn>
            <v-btn color="error" @click="deleteGame(gameId)"> Delete </v-btn>
          </v-card-actions>
        </v-card>

        <v-card class="mt-6">
          <v-card-title> Mass game management </v-card-title>
          <v-card-text>
            <v-textarea v-model="gameIds" label="Game IDs" hint="Game ids separated by newlines" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="replayGames()"> Mass replay </v-btn>
            <v-btn @click="loadReplays()"> Load replays </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="6">
        <v-card>
          <v-card-title>Email management</v-card-title>
          <v-card-text>
            <v-text-field v-model="email" label="Email" type="email" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="invite(email)"> Invite </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
