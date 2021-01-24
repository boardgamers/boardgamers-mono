<template>
  <b-list-group flush class="d-none d-lg-block ml-n3" style="width: 250px">
    <b-list-group-item
      v-for="game in games"
      :to="gameRoute(game._id.game)"
      :class="{ active: $route.params.boardgameId === game._id.game }"
      :key="game._id.game"
    >
      <span style="font-weight: 600">{{ game.label }}</span>
    </b-list-group-item>
  </b-list-group>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";

@Component
export default class GameListSidebar extends Vue {
  get games() {
    return this.$gameInfo.latest;
  }

  gameRoute(gameId: string) {
    if (gameId === this.$route.params.boardgameId) {
      if (this.$route.name === "boardgame") {
        return "/refresh-games";
      } else {
        return {
          name: "boardgame",
          params: { boardgameId: gameId },
        };
      }
    }

    if (!this.$route.params.boardgameId) {
      return {
        name: "boardgame",
        params: { boardgameId: gameId },
      };
    }

    return {
      name: this.$route.name,
      hash: this.$route.hash,
      params: { ...this.$route.params, boardgameId: gameId },
    };
  }
}
</script>
<style lang="scss"></style>
