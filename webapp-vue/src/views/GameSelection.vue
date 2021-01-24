<template>
  <div class="container">
    <h1 class="mb-4">{{ title }}</h1>
    <v-loading :loading="loading">
      <b-card-group deck class="game-choice">
        <b-card
          v-for="game in info"
          :key="game._id.game + game._id.version"
          @click="cardClick(game._id.game)"
          border-variant="secondary"
          :header="game.label"
          align="center"
        >
          <b-card-text v-html="marked(game.description)" align="left"></b-card-text>
          <template #footer>
            <span
              v-if="$gameSettings.allSettings.some((x) => x.game === game._id.game && x.access.ownership)"
              class="text-info"
              >You own this game</span
            >
            <span v-else class="text-secondary">You do not own this game</span>
          </template>
        </b-card>
      </b-card-group>
    </v-loading>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import marked from "marked";
import { GamePreferences } from "@gaia-project/site-lib/gamepreferences";

@Component
export default class GameSelection extends Vue {
  @Prop({ default: false, type: Boolean })
  newGame: boolean;

  @Prop({ default: "Game selection" })
  title: string;

  get loading() {
    return this.info.length === 0;
  }

  get info() {
    return this.$gameInfo.latest;
  }

  marked = marked;

  cardClick(game: string) {
    if (this.newGame) {
      if (
        this.$gameInfo.info(game, "latest").meta.needOwnership &&
        !this.$gameSettings.allSettings.some((x) => x.game === game && x.access.ownership)
      ) {
        this.$bvModal.msgBoxOk(
          "You need to have game ownership to host a new game. You can set game ownership in your account settings.",
          { title: "Game ownership needed" }
        );
      } else {
        this.$router.push(`/new-game/${game}`);
      }
      return;
    }

    this.$router.push(`/boardgame/${game}`);
  }

  @Watch("$store.state.user", { immediate: true })
  onUserUpdated() {
    this.$gameSettings.loadAll();
    this.$gameInfo.loadAll();
  }
}
</script>
<style lang="scss" scoped>
@import "../stylesheets/variables.scss";

.game-choice {
  .card {
    transition: border-color;
    transition-duration: 0.3s;
    transition-timing-function: ease;
  }

  .card:hover {
    border-color: $info !important;

    cursor: pointer;
  }

  .card-header {
    transition: color;
    transition-duration: 0.3s;
    transition-timing-function: ease;
  }
  .card:hover .card-header {
    color: $info;
  }
}
</style>
