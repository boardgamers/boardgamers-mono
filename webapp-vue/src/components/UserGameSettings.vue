<template>
  <b-card border-variant="secondary" :header="title || game.label" align="center">
    <b-card-text align="left">
      <v-loading :loading="!prefs">
        <template v-if="prefs">
          <b-checkbox v-model="ownership" @change="postOwnership">I own this game</b-checkbox>
          <template v-if="game.preferences && game.preferences.length > 0">
            <hr />
            <template v-for="pref in game.preferences">
              <b-checkbox v-model="prefs.preferences[pref.name]" :key="pref.name" @change="postPreferences">{{
                pref.label
              }}</b-checkbox>
            </template>
          </template>
        </template>
      </v-loading>
      <!-- v-html="marked(game.description)" align="left" -->
    </b-card-text>
  </b-card>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import type { GameInfo } from "@lib/gameinfo";
import marked from "marked";
import { handleError } from "../utils";
import { pick } from "lodash";
import type { GamePreferences } from "@lib/gamepreferences";

@Component
export default class UserGameSettings extends Vue {
  @Prop({ default: "" })
  title: string;

  @Prop()
  game: GameInfo;

  get prefs() {
    return this.$gameSettings.settings(this.game._id.game);
  }

  get prefItems() {
    let data = this.game.preferences;

    if (data && this.game.viewer?.alternate?.url) {
      data = [{ name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null }, ...data];
    }

    return data;
  }

  marked = marked;
  ownership = false;

  @Watch("prefs", { immediate: true })
  onPrefsUpdated() {
    console.log("prefs updated");
    this.ownership = this.prefs?.access.ownership ?? false;
  }

  @Watch("game._id.game", { immediate: true })
  async onGameUpdated(game: string) {
    this.$gameSettings.loadSettings(game);
  }

  async postOwnership() {
    // I don't know why this is the order of operations, but this is needed
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (this.ownership) {
      const res = await this.$bvModal.msgBoxConfirm("I certify on my honor that I own a copy of the game");

      if (!res) {
        this.ownership = false;
        return;
      }
    }
    try {
      await this.$axios.post(`/account/games/${this.game._id.game}/ownership`, {
        access: { ...this.prefs.access, ownership: this.ownership },
      });
      this.$store.commit("gameSettings", {
        ...this.prefs,
        access: { ...this.prefs.access, ownership: this.ownership },
      });
    } catch (err) {
      handleError(err);
    }
  }

  async postPreferences() {
    await this.$axios
      .post(`/account/games/${this.game._id.game}/preferences/${this.game._id.version}`, this.prefs.preferences)
      .catch(handleError);
    this.$store.commit("gameSettings", { ...this.prefs });
  }
}
</script>
