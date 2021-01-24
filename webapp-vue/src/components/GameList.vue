<template>
  <v-loading :loading="loadingGames">
    <h3 class="card-title">
      {{ title }} <span class="small" v-if="!topRecords && !sample">({{ count }})</span>
    </h3>
    <div v-if="games.length > 0">
      <ul class="list-group text-left game-list">
        <router-link
          :to="`/game/${game._id}`"
          v-for="game in games"
          :key="game._id"
          :class="[
            'list-group-item',
            'list-group-item-action',
            {
              'active-game': !game.open || !game.active,
              'current-turn': game.currentPlayers && game.currentPlayers.some((pl) => pl._id === userId),
            },
            'py2',
            'pr-1',
            'pl-0',
          ]"
        >
          <span :class="['game-kind', 'mx-3']">
            <template v-if="game.game.expansions.includes('spaceships')"> 🚀 </template>
            <template v-else-if="game.game.name === 'take6'"> 6️⃣ </template>
            <template v-else> 🌏 </template>
          </span>

          <div class="mr-auto" style="line-height: 1.1">
            <div>
              <b-badge v-if="game.status === 'active'" class="small">R{{ game.data.round }}</b-badge>
              <span class="game-name">
                {{ game._id }}
              </span>
              <sup class="ml-1" v-if="playerEloChange(game)">
                {{ playerEloChange(game) }}
              </sup>
            </div>
            <div v-if="game.status !== 'ended'">
              <small>
                <b-icon icon="clock-history" /> {{ playTime(game) }} /
                {{ game.options.timing.timePerGame | duration }} + {{ game.options.timing.timePerMove | duration }}
                <span v-if="game.options.timing.scheduledStart">
                  starts on {{ game.options.timing.scheduledStart | niceDate }} at
                  {{ new Date(game.options.timing.scheduledStart).getHours().toString().padStart(2, "0") }}h{{
                    new Date(game.options.timing.scheduledStart).getMinutes().toString().padStart(2, "0")
                  }}</span
                >
              </small>
            </div>
            <div v-else>
              <small>
                {{ game.lastMove | niceDate }}
              </small>
            </div>
          </div>

          <div class="row no-gutters factions" v-if="game.status !== 'open'">
            <div
              v-for="player in game.players"
              :key="player._id"
              :style="`background-image: url('${
                player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
              }')`"
              :title="player.faction || 'unknown'"
              :class="['player-avatar', 'mr-1', { current: userId && player._id === userId }]"
            >
              <span class="vp">{{ player.score }}</span>
            </div>
          </div>
          <span v-else class="mr-3"> {{ game.players.length }} / {{ game.options.setup.nbPlayers }} </span>
        </router-link>
      </ul>
      <b-pagination
        class="mt-1"
        v-if="!topRecords && count > perPage"
        size="md"
        align="right"
        :total-rows="count"
        v-model="currentPage"
        :per-page="perPage"
      />
    </div>
    <p v-else>No games to show</p>
  </v-loading>
</template>
<script lang="ts">
import Vue from "vue";
import { Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { IGame } from "@lib/game";
import { timerTime } from "../utils";

@Component<GameList>({
  async created() {
    const unsubscribe = this.$store.subscribeAction(({ type }) => {
      if (type !== "logoClick") {
        return;
      }
      this.loadGames(true);
    });

    this.$once("hook:beforeDestroy", unsubscribe);
  },
})
export default class GameList extends Vue {
  @Prop({ default: null })
  userId: string;

  @Prop({ default: 0, type: Number })
  sample!: number;

  @Prop({ default: 10 })
  perPage: number;

  @Prop()
  boardgameId: string;

  @Prop()
  gameStatus: string;

  @Prop()
  title: string;

  @Prop({ default: 0 })
  topRecords: number;

  @Watch("userId", { immediate: true })
  @Watch("boardgameId")
  async onUserChanged() {
    this.loadGames(true);
  }

  @Watch("currentPage")
  async onChangePage() {
    this.loadGames(false);
  }

  async loadGames(refresh: boolean) {
    const queryParams: any = {};

    try {
      if (this.sample) {
        queryParams.sample = true;
      }
      if (this.userId) {
        queryParams.user = this.userId;
      }

      if (refresh) {
        this.loadingGames = true;

        if (!this.sample && !this.topRecords) {
          this.count = await this.$axios.get(`${this.prefix}/count`, { params: queryParams }).then((r) => r.data);
        }
      }

      queryParams.count = this.topRecords || this.sample || this.perPage;
      this.games = await this.$axios
        .get(this.prefix, { params: { ...queryParams, skip: (this.currentPage - 1) * this.perPage } })
        .then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loadingGames = false;
    }
  }

  get prefix() {
    return this.boardgameId ? `/boardgame/${this.boardgameId}/games/${this.gameStatus}` : `/game/${this.gameStatus}`;
  }

  games: IGame[] = [];
  loadingGames = true;
  count: number = 0;
  currentPage = 1;

  playTime(game: IGame) {
    if (game.options.timing.timer?.start !== game.options.timing.timer?.end) {
      return `${timerTime(game.options.timing.timer?.start)}-${timerTime(game.options.timing.timer?.end)}`;
    } else {
      return "24h";
    }
  }

  playerEloChange(game: IGame) {
    const pl = game.players.find((pl) => pl._id === this.userId);

    if (!pl || !pl.elo) {
      return;
    }

    const elo = pl.elo.initial ?? 0;
    const delta = pl.elo.delta ?? 0;
    return elo === 0 && delta === 0 ? "" : (delta >= 0 ? "( +" : "( -") + Math.abs(delta) + " elo )";
  }
}
</script>

<style lang="scss">
// @import "../stylesheets/main.scss";

.list-group.game-list {
  .list-group-item {
    display: flex;
    align-items: center;

    &.current-turn {
      background: lightgreen;

      &:hover,
      &:focus {
        background: darken($color: lightgreen, $amount: 5%);
      }

      &:active {
        background: darken($color: lightgreen, $amount: 10%);
      }
    }

    &.active-game {
      .factions {
        // On mobile, if multiple lines, I want items to be aligned to the right
        justify-content: flex-end;
      }
    }

    .game-kind {
      font-size: 1.8em;
    }

    .game-name {
      // font-weight: 600;
    }
  }
}

.player-avatar {
  height: 2em;
  width: 2em;
  display: inline-block;
  position: relative;
  border-radius: 50%;
  vertical-align: middle;
  background-size: cover;

  .vp {
    position: absolute;
    right: -5px;
    bottom: -5px;
    font-size: 0.7em;
    border-radius: 5px;
    color: white;
    background-color: #838383;
    width: 20px;
    text-align: center;
  }

  &.current {
    border: 3px solid #333;

    .vp {
      background-color: #6673bc;
    }
  }
}
</style>
