<template>
  <div class="container account">
    <b-row>
      <b-col
        ><h1>{{ username }}</h1></b-col
      >
      <b-col class="text-right"
        ><b-button
          variant="primary"
          to="/account"
          v-if="$store.state.user && user && $store.state.user._id === user._id"
          >Settings</b-button
        ></b-col
      >
    </b-row>
    <v-loading :loading="loading">
      <UserPublicInfo class="mt-4" v-if="user" :user="user" />
      <UserGames v-if="user" :userId="user._id" />
      <b-card border-variant="info" class="mt-4" header="Statistics">
        <b-row>
          <b-col lg="6" class="mb-3">
            <UserElo v-if="user" :userId="user._id" />
          </b-col>
          <b-col>
            <h3 class="card-title">Tournaments</h3>
            <p>No Tournament info available</p>
          </b-col>
        </b-row>
      </b-card>
    </v-loading>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError, dateFromObjectId } from "@/utils";
import { IUser } from "@gaia-project/site-lib/user";
import UserGames from "../components/UserGames.vue";
import UserPublicInfo from "../components/UserPublicInfo.vue";
import UserElo from "../components/UserElo.vue";

@Component({
  async created(this: User) {
    try {
      this.user = await this.$axios.get(`/user/infoByName/${encodeURIComponent(this.username)}`).then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  },
  components: {
    UserGames,
    UserPublicInfo,
    UserElo,
  },
})
export default class User extends Vue {
  loading = true;

  user: IUser = null;

  @Prop()
  username: string;
}
</script>
