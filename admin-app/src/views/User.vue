<template>
  <div>
    <v-card :loading="loading">
      <v-card-title> User management </v-card-title>
      <v-card-text>
        <v-text-field label="Karma" type="number" v-model="user.account.karma" @change="updateKarma"></v-text-field>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-btn @click="confirmUser" :disabled="user && user.security && user.security.confirmed">Confirm user</v-btn>
        <v-btn @click="login">Log in as</v-btn>
      </v-card-actions>
    </v-card>
    <v-card class="mt-4" :loading="loading">
      <v-card-title> Boardgame management </v-card-title>
      <v-card-text>
        <v-text-field label="Boardgame name" v-model="gameName" />
        <v-text-field type="number" label="Elo" v-model="elo" />
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-btn @click="grantAccess">
          <v-icon class="mr-2">mdi-check</v-icon>
          Grant access
        </v-btn>
        <v-btn @click="changeElo"> Change elo </v-btn>
      </v-card-actions>
    </v-card>

    <v-card class="mt-4">
      <v-card-title>Api Errors</v-card-title>
      <v-data-table
        :headers="apiHeaders"
        :items="apiErrors"
        item-key="_id"
        single-expand
        show-expand
        :loading="apiLoading"
      >
        <template v-slot:expanded-item="{ item }">
          <td :colspan="apiHeaders.length">
            <pre>{{ JSON.stringify(item, null, 2) }}</pre>
          </td>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError, handleInfo } from "@/utils";
import { IUser } from "@lib/user";
import { pick } from "lodash";
import { ApiError } from "@lib/api-error";
import { GamePreferences } from "@lib/gamepreferences";

@Component
export default class User extends Vue {
  @Prop()
  username!: string;

  gameName = "";
  elo = 0;
  apiErrors: ApiError[] = [];
  apiLoading = false;

  user?: IUser;
  prefs: GamePreferences<string>[] = [];

  loading = true;

  get apiHeaders() {
    return [
      { text: "Name", value: "error.name" },
      { text: "Method", value: "request.method" },
      { text: "url", value: "request.url" },
    ];
  }

  async grantAccess() {
    try {
      await this.$axios.post(`/admin/users/${this.user!._id}/access/grant`, {
        type: "game",
        game: this.gameName,
        version: "latest",
      });
      handleInfo("Access granted to " + this.gameName + "!");
    } catch (err) {
      handleError(err);
    }
  }

  async changeElo() {
    try {
      await this.$axios.post(`/admin/users/${this.user!._id}/elo/` + this.gameName, {
        value: +this.elo,
      });
      handleInfo("Elo changed!");
    } catch (err) {
      handleError(err);
    }
  }

  async confirmUser() {
    try {
      await this.$axios.post(`/admin/users/${this.user!._id}/confirm`, {});
      handleInfo("User confirmed!");
    } catch (err) {
      handleError(err);
    }
  }

  login() {
    this.$axios.post("/admin/login-as", { username: this.user!.account.username }).then(({ data }) => {
      const { refreshToken } = data;

      if (location.hostname === "localhost") {
        location.href = "http://localhost:8612/login?refreshToken=" + encodeURIComponent(JSON.stringify(refreshToken));
      } else {
        location.href =
          "//" +
          location.hostname.slice("admin.".length) +
          "/login?refreshToken=" +
          encodeURIComponent(JSON.stringify(refreshToken));
      }
    }, handleError);
  }

  @Watch("username", { immediate: true })
  async onUserChanged() {
    this.loading = true;
    this.apiLoading = true;

    try {
      this.user = await this.$axios.get("/admin/users/infoByName/" + this.username).then((r) => r.data);

      [this.apiErrors] = await Promise.all([
        this.$axios.get("/admin/users/" + this.user!._id + "/api-errors").then((r) => r.data),
      ]);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
      this.apiLoading = false;
    }
  }

  async updateKarma(value: string) {
    if (value && !isNaN(+value)) {
      await this.$axios.post("/admin/users/" + this.user?._id, pick(this.user, "account.karma"));
      handleInfo("Karma updated to " + +value);
    }
  }
}
</script>
