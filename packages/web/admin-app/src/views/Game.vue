<template>
  <div>
    <h2 v-if="gameInfo">{{ gameInfo.label }} - version {{ gameInfo._id.version }}</h2>
    <GameEdit :gameInfo="gameInfo" mode="edit" @game:update="updateGame($event)" v-if="gameInfo" />
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError, handleSuccess } from "@/utils";
import { GameInfo } from "@lib/gameinfo";
import GameEdit from "../components/GameEdit.vue";

@Component({
  async created(this: Game) {},
  components: {
    GameEdit,
  },
})
export default class Game extends Vue {
  gameInfo: GameInfo | null = null;
  loading = true;

  @Prop()
  game!: string;

  @Prop()
  version!: string;

  async updateGame(gameInfo: GameInfo) {
    try {
      await this.$axios.post(`/admin/gameinfo/${gameInfo._id.game}/${gameInfo._id.version}`, gameInfo);
      this.gameInfo = gameInfo;
      handleSuccess("Game updated");
    } catch (err) {
      handleError(err);
    }
  }

  @Watch("game", { immediate: true })
  @Watch("version")
  async onRouteUpdated() {
    this.loading = true;
    try {
      this.gameInfo = await this.$axios.get(`/admin/gameinfo/${this.game}/${this.version}`).then((r) => r.data);
      console.log(this.gameInfo);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  }
}
</script>
