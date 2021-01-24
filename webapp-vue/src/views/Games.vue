<template>
  <v-loading div class="container">
    <b-tabs pills>
      <b-tab title="Started" active>
        <b-row class="mt-2">
          <b-col md="6" class="mb-2">
            <GameList gameStatus="active" title="Active" :boardgameId="boardgameId" />
          </b-col>
          <b-col md="6" class="mb-2">
            <GameList gameStatus="closed" title="Finished" :boardgameId="boardgameId" />
          </b-col>
        </b-row>
      </b-tab>
      <b-tab title="Open">
        <b-row class="mt-2">
          <b-col md="6" class="mb-2">
            <GameList gameStatus="open" title="Open" :boardgameId="boardgameId" />
          </b-col>
        </b-row>
      </b-tab>
      <template v-slot:tabs-start>
        <h1 class="mr-3">Games</h1>
      </template>
    </b-tabs>
  </v-loading>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { handleError } from "@/utils";
import GameList from "../components/GameList.vue";
import { IGame } from "@lib/game";

@Component<Games>({
  components: {
    GameList,
  },
})
export default class Games extends Vue {
  @Prop()
  boardgameId: string;

  get firstTab() {
    return this.$route.hash !== "#open";
  }
}
</script>
