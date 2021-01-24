<template>
  <div>
    <h3>{{ title }}</h3>
    <ul class="list-group text-left">
      <router-link
        v-for="(bgElo, pos) in boardgameElo"
        :to="{ name: 'user', params: { username: bgElo.userData[0].account.username }, hash: '#elo' }"
        :key="bgElo._id"
        :class="['list-group-item', 'list-group-item-action', 'py2']"
      >
        <span
          ><b>{{ pos + 1 + (currentPage - 1) * 10 }}</b> - {{ bgElo.userData[0].account.username }} -
          <b>{{ bgElo.elo.value }}</b> elo in {{ bgElo.elo.games | pluralize("game") }}</span
        >
      </router-link>
    </ul>
    <b-pagination
      class="mt-1"
      size="md"
      align="right"
      v-if="!top"
      :total-rows="count - 1"
      v-model="currentPage"
      :per-page="10"
    />
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { GamePreferences } from "@lib/gamepreferences";

@Component
export default class BoardgameElo extends Vue {
  @Prop()
  boardgameId: string;

  @Prop({ type: Number, default: 0 })
  top: number;

  loading = true;

  boardgameElo = [];
  count: number = 0;
  currentPage = 1;

  get title() {
    if (this.top) {
      return "Top ranked players";
    } else {
      return "Elo";
    }
  }

  @Watch("boardgameId", { immediate: true })
  async onUserChanged() {
    this.loadGames(true);
  }

  @Watch("currentPage")
  async onChangePage() {
    this.loadGames(false);
  }

  async loadGames(refresh: boolean) {
    const baseURL = `/boardgame/${this.boardgameId}/elo`;

    try {
      if (refresh) {
        this.loading = true;

        if (!this.top) {
          this.count = await this.$axios.get(`${baseURL}/count`).then((r) => r.data);
        }
      }

      this.boardgameElo = await this.$axios
        .get(baseURL, { params: { skip: (this.currentPage - 1) * 10, count: this.top || 10 } })
        .then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  }
}
</script>
