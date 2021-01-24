<template>
  <div class="home container">
    <v-loading :loading="loading">
      <div v-if="boardgame">
        <h1>{{ boardgame.label }}</h1>

        <b-card-group deck class="mt-3">
          <b-card border-variant="secondary">
            <template #header>Description</template>
            <b-card-text v-html="marked(boardgame.description)" align="left"></b-card-text>
          </b-card>
          <UserGameSettings title="Settings" :game="boardgame" />
        </b-card-group>

        <b-row>
          <b-col lg="6" class="mt-3">
            <GameList
              key="active"
              :boardgameId="boardgameId"
              gameStatus="active"
              :userId="user ? user._id : null"
              :sample="user ? 0 : 5"
              :title="user ? 'My games' : 'Featured games'"
            />
          </b-col>
          <b-col lg="6" class="mt-3">
            <GameList :sample="5" :boardgameId="boardgameId" gameStatus="open" title="Lobby" />
          </b-col>
        </b-row>

        <div class="text-center mt-3">
          <b-button :to="{ name: 'bg-games', params: { boardgameId } }">All games</b-button>
          <b-button variant="primary" @click="newGame()" class="mx-3">New Game</b-button>
          <b-button :to="{ name: 'bg-rankings', params: { boardgameId } }">Rankings</b-button>
        </div>

        <b-row>
          <b-col lg="6" class="mt-3">
            <GameList
              key="active"
              gameStatus="active"
              :boardgameId="boardgameId"
              :top-records="5"
              title="Featured games"
            />
            <!-- <h3>Tournaments</h3>
            <p> No Tournament info available </p> -->
          </b-col>
          <b-col lg="6" class="mt-3">
            <!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
            <BoardgameElo :boardgameId="boardgameId" :top="5" />
          </b-col>
        </b-row>
      </div>
    </v-loading>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import marked from "marked";
import { GameInfo } from "@gaia-project/site-lib/gameinfo";
import Games from "../views/Games.vue";
import GameList from "../components/GameList.vue";
import BoardgameElo from "../components/BoardgameElo.vue";
import UserGameSettings from "../components/UserGameSettings.vue";

@Component({
  components: {
    GameList,
    Games,
    BoardgameElo,
    UserGameSettings,
  },
})
export default class Boardgame extends Vue {
  @Prop()
  boardgameId: string;

  boardgame: GameInfo = null;

  loading = true;
  marked = marked;

  @Watch("boardgameId", { immediate: true })
  async init() {
    try {
      this.loading = true;
      this.boardgame = await this.$axios.get(`/boardgame/${this.boardgameId}/info`).then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  }

  get info() {
    return this.$gameInfo.latest;
  }

  get hasOwnership() {
    return this.$gameSettings.allSettings.some((x) => x.game === this.boardgameId && x.access.ownership);
  }

  get needOwnership() {
    return this.$gameInfo.info(this.boardgameId, "latest").meta.needOwnership;
  }

  newGame() {
    if (this.needOwnership && !this.hasOwnership) {
      this.$bvModal.msgBoxOk(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings.",
        { title: "Game ownership needed" }
      );
    } else {
      this.$router.push(`/new-game/${this.boardgameId}`);
    }
  }

  get user() {
    return this.$store.state.user;
  }

  @Watch("user", { immediate: true })
  onUserUpdated() {
    this.$gameSettings.loadAll();
    this.$gameInfo.loadAll();
  }
}
</script>
<style lang="scss" scoped>
@import "../stylesheets/variables.scss";
</style>
