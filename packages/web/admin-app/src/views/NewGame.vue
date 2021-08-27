<template>
  <div>
    <h2>New game</h2>
    <GameEdit @game:update="updateGame($event)" mode="new" />
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { GameInfo } from "../types";
import { handleError, handleSuccess } from "../utils";
import GameEdit from "../components/GameEdit.vue";

@Component({
  components: { GameEdit },
})
export default class NewGame extends Vue {
  async updateGame(gameInfo: GameInfo) {
    try {
      await this.$axios.post(`/admin/gameinfo/${gameInfo._id.game}/${gameInfo._id.version}`, gameInfo);
      handleSuccess("Game created");

      this.$store.commit("games", await this.$axios.get("/admin/gameinfo").then((r) => r.data));
      this.$router.push({ name: "game", params: { version: "" + gameInfo._id.version, game: gameInfo._id.game } });
    } catch (err) {
      handleError(err);
    }
  }
}
</script>
