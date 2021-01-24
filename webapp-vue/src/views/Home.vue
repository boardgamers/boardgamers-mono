<template>
  <div class="d-flex">
    <GameSidebar />
    <div class="text-center container">
      <div class="py-2 text-center">
        <p class="lead" v-if="announcement" v-html="announcement"></p>
      </div>
      <b-row>
        <b-col lg="6" class="mt-3">
          <GameList
            key="active-mine"
            gameStatus="active"
            v-if="activeGames && activeGames.length"
            :userId="user._id"
            :per-page="5"
            title="My games"
          />
          <GameList key="active" gameStatus="active" v-else :top-records="5" title="Featured games" />
        </b-col>
        <b-col lg="6" class="mt-3">
          <GameList :sample="5" gameStatus="open" title="Lobby" />
        </b-col>
      </b-row>
      <div class="text-center mt-3">
        <b-button :to="{ name: 'bg-games', params: { boardgameId } }">All games</b-button>
        <b-button variant="primary" to="/new-game" class="ml-3">New Game</b-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { Game } from "@/types";
import GameList from "../components/GameList.vue";
import GameSidebar from "../components/GameListSidebar.vue";

@Component<Home>({
  async created() {
    this.$gameInfo.loadAll();
    try {
      this.announcement = await this.$axios.get("/site/announcement").then((r) => r.data);
    } catch (err) {
      handleError(err);
    }
  },
  components: {
    GameList,
    GameSidebar,
  },
})
export default class Home extends Vue {
  announcement: string = "";

  get user() {
    return this.$store.state.user;
  }

  get activeGames(): string[] {
    return this.$store.state.activeGames;
  }
}
</script>

<style lang="scss">
.lead {
  font-size: 1.25rem;
  font-weight: 300;
}
</style>
