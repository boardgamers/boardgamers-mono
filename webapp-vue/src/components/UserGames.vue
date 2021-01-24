<template>
  <b-card v-if="userId" border-variant="info" class="mt-4" header="Games">
    <b-row>
      <b-col lg="6" class="mb-3">
        <GameList gameStatus="active" :perPage="5" :userId="userId" title="Active games" />
      </b-col>
      <b-col>
        <GameList gameStatus="closed" :perPage="5" :userId="userId" title="Finished games" />
      </b-col>
    </b-row>
  </b-card>
</template>

<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { IGame } from "@lib/game";
import { IUser } from "@lib/user";
import GameList from "./GameList.vue";

@Component({
  components: {
    GameList,
  },
})
export default class UserGames extends Vue {
  @Prop({ default: null })
  userId: string;

  get loggedUser(): IUser {
    return this.$store.state.user;
  }
}
</script>
