<template>
  <div class="d-flex"><GameListSidebar /><router-view /></div>
  <!-- Todo: add sidebar for list of games -->
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import GameListSidebar from "../components/GameListSidebar.vue";

@Component({
  components: { GameListSidebar },
  created() {
    this.$gameInfo.loadAll();
  },
})
export default class BoardgameLayout extends Vue {}
</script>
