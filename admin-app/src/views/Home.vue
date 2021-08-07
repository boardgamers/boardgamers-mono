<template>
  <div>
    <v-row>
      <v-col cols="6">
        <v-card :loading="!serverInfo">
          <v-card-title>Server info</v-card-title>
          <v-card-text v-if="serverInfo">
            Available space: {{ serverInfo.disk.free | filesize }} / {{ serverInfo.disk.size | filesize }} <br />
            Users: {{ serverInfo.nbUsers }} <br />

            <v-textarea v-model="announcement"></v-textarea>
          </v-card-text>
          <v-divider />
          <v-card-actions><v-btn color="primary" @click="updateAnnouncement">Update</v-btn></v-card-actions>
        </v-card>

        <v-card class="mt-6">
          <v-card-title> Game management </v-card-title>
          <v-card-text>
            <v-text-field label="Game ID" v-model="gameId" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="replayGame(gameId)">Replay</v-btn>
            <v-btn color="error" @click="deleteGame(gameId)">Delete</v-btn>
          </v-card-actions>
        </v-card>

        <v-card class="mt-6">
          <v-card-title> Mass game management </v-card-title>
          <v-card-text>
            <v-textarea label="Game IDs" v-model="gameIds" hint="Game ids separated by newlines" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" @click="replayGames()">Mass replay</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <v-col cols="6">
        <v-card>
          <v-card-title>Email management</v-card-title>
          <v-card-text>
            <v-text-field label="Email" v-model="email" type="email" />
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn @click="invite(email)" color="primary">Invite</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError, handleInfo } from "../utils";

@Component
export default class Home extends Vue {
  serverInfo: { disk: { availabe: number; total: number }; nbUsers: number; announcement: string } | null = null;
  email = "";
  username = "";
  gameId = "";
  gameIds = "";
  announcement = "";

  constructor() {
    super();

    this.loadServerInfo();
  }

  loadServerInfo() {
    this.$axios.get("/admin/serverinfo").then((r) => (this.serverInfo = r.data), handleError);
  }

  resend(email: string) {
    this.$axios.post("/admin/resend-confirmation", { email }).then((info) => handleInfo("Email sent!"), handleError);
  }

  invite(email: string) {
    this.$axios.post("/admin/invite", { email }).then((info) => handleInfo("Invite sent!"), handleError);
  }

  deleteGame(gameId: string) {
    this.$axios.delete(`/game/${gameId}`).then((info) => handleInfo("Game deleted!"), handleError);
  }

  replayGame(gameId: string) {
    this.$axios.post(`/gameplay/${gameId}/replay`, {}).then((info) => handleInfo("Game replayed."), handleError);
  }

  replayGames() {
    handleInfo("Batch replay started");
    this.$axios
      .post(`/gameplay/batch/replay`, { gameIds: this.gameIds.split("\n").map((x) => x.trim()) })
      .then((info) => handleInfo("Games replayed: " + info.data.success), handleError);
  }

  redoKarma(username: string) {
    this.$axios.post("/admin/compute-karma", { username }).then(() => handleInfo("Karma computed"), handleError);
  }

  recomputeAllKarma() {
    this.$axios.post("/admin/compute-all-karma", {}).then(() => handleInfo("Karma computed"), handleError);
  }

  recreate() {
    this.$axios
      .post("/admin/recreate-notifications", {})
      .then((resp) => handleInfo(resp.data.length + " game notifications created"), handleError);
  }

  updateAnnouncement() {
    this.$axios
      .post("/admin/announcement", { announcement: this.announcement })
      .then(() => handleInfo("Announcement updated"), handleError);
  }

  @Watch("serverInfo")
  onServerInfoUpdated() {
    if (this.serverInfo?.announcement) {
      this.announcement = this.serverInfo?.announcement;
    }
  }
}
</script>
