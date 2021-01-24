<template>
  <div class="container">
    <h1>Rankings</h1>
    <b-row>
      <b-col md="6">
        <BoardgameElo :boardgameId="boardgameId" />
      </b-col>

      <b-col md="6">
        <h3>Tournaments</h3>
        <p>No Tournament ranking available</p>
      </b-col>
    </b-row>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import BoardgameElo from "../components/BoardgameElo.vue";

@Component({
  components: {
    BoardgameElo,
  },
})
export default class Rankings extends Vue {
  @Prop()
  boardgameId: string;
}
</script>
