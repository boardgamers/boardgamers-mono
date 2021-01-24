<template>
  <div border-variant="secondary" v-if="gamePreferences.some((pref) => pref.elo)">
    <h3 class="card-title">Elo</h3>
    <ul class="list-group text-left">
      <div
        v-for="gamePref in gamePreferences.filter((pref) => pref.elo)"
        :key="gamePref.game"
        :class="['list-group-item', 'list-group-item-action', 'py2']"
      >
        <span
          >{{ gameName(gamePref.game) }} - <b>{{ gamePref.elo.value }}</b> in
          {{ gamePref.elo.games | pluralize("game") }}</span
        >
      </div>
    </ul>
    <!-- <div class="py-1"/>
      <router-link :to="`/page/elo`">How it works</router-link> -->
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { GamePreferences } from "@gaia-project/site-lib/gamepreferences";

@Component({
  async created(this: UserElo) {
    try {
      this.gamePreferences = await this.$axios.get(`/user/${this.userId}/games/elo`).then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  },
  components: {},
})
export default class UserElo extends Vue {
  @Prop()
  userId: string;

  loading = true;

  gamePreferences: GamePreferences[] = [];

  gameName(game: string) {
    const info = this.$gameInfo.info(game, "latest");

    if (!info) {
      this.$gameInfo.loadGameInfo(game, "latest");
      return game;
    }

    return info.label;
  }
}
</script>
