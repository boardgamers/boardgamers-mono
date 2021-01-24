<template>
  <div>
    <v-autocomplete label="Username" v-model="username" :search-input.sync="search" :loading="loading" :items="items">
    </v-autocomplete>

    <v-autocomplete
      label="Email"
      v-model="email"
      :search-input.sync="emailSearch"
      :loading="emailLoading"
      :items="emailItems"
    >
    </v-autocomplete>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "../utils";
import { IUser } from "@gaia-project/site-lib/user";

@Component
export default class Users extends Vue {
  username = "";
  email = "";
  loading = false;
  emailLoading = false;
  items: Array<{ text: string; value: string }> = [];
  emailItems: Array<{ text: string; value: string }> = [];
  search = "";
  emailSearch = "";

  @Watch("search")
  async remoteMethod(query: string) {
    if (query !== "") {
      try {
        this.loading = true;

        const users: Array<IUser> = await this.$axios
          .get(`/admin/users/search`, { params: { query } })
          .then((r) => r.data);

        this.items = users.map((user) => ({ text: user.account.username, value: user.account.username }));
      } catch (err) {
        handleError(err);
      } finally {
        this.loading = false;
      }
    } else {
      this.items = [];
    }
  }

  @Watch("emailSearch")
  async remoteEmailMethod(query: string) {
    if (query !== "") {
      try {
        this.emailLoading = true;

        const users: Array<IUser> = await this.$axios
          .get(`/admin/users/search`, { params: { query, mode: "email" } })
          .then((r) => r.data);

        this.emailItems = users.map((user) => ({ text: user.account.username, value: user.account.username }));
      } catch (err) {
        handleError(err);
      } finally {
        this.emailLoading = false;
      }
    } else {
      this.emailItems = [];
    }
  }

  @Watch("username")
  onUsernameChanged() {
    if (this.username) {
      this.$router.push({ name: "user", params: { username: this.username } });
    }
  }
}
</script>
