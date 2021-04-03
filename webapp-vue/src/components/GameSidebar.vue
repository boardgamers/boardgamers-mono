<template>
  <div>
    <portal to="sidebar">
      <h3 class="mt-75">Players</h3>
      <div
        v-for="player in game.players"
        :key="player._id"
        :class="['mb-1 d-flex align-items-center player-row', { active: isCurrentPlayer(player._id) }]"
      >
        <div
          :style="`background-image: url('${
            player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
          }')`"
          :title="player.faction || 'unknown'"
          :class="['player-avatar', 'mr-2', { current: user && player._id === user }]"
        >
          <span :class="['vp', status(player._id)]">{{ player.score }}</span>
        </div>
        <router-link :to="`/user/${player.name}`" :class="['player-name', { dropped: player.dropped }]">{{
          player.name
        }}</router-link>
        <sup class="ml-1">
          <template v-if="player.elo">
            {{ player.elo.initial }} {{ player.elo.delta | sign }} {{ Math.abs(player.elo.delta) }} elo
          </template>
          <template v-else> {{ playerElo(player._id) }} elo </template>
        </sup>
        <span v-if="game.status === 'active'" class="ml-1"> - {{ remainingTime(player) | shortDuration }}</span>
      </div>
      <div class="mt-75">
        <b-icon icon="clock-history" class="mr-1" />
        {{
          alwaysActive
            ? "24h"
            : `${timerTime(game.options.timing.timer.start)}-${timerTime(game.options.timing.timer.end)}`
        }}
        / {{ game.options.timing.timePerGame | duration }} + {{ game.options.timing.timePerMove | duration }}
      </div>
      <div class="mt-75" v-if="game.status === 'ended'">
        <b> Game ended! </b>
      </div>
      <div v-if="user && isCurrentPlayer(user._id)" class="mt-75">
        <b class="your-turn">Your turn!</b>
      </div>
      <div v-if="playerUser && game.status !== 'ended'" class="mt-75">
        <b-btn
          variant="warning"
          size="sm"
          :disabled="playerUser.dropped || playerUser.voteCancel || playerUser.quit"
          @click="voteCancel"
        >
          Vote to cancel
        </b-btn>
        <b-btn
          size="sm"
          class="ml-2"
          v-if="game.players.some((pl) => !!pl.dropped)"
          :disabled="playerUser.dropped || playerUser.quit"
          @click="quit"
        >
          Quit
        </b-btn>
        <b-btn
          size="sm"
          class="ml-2"
          variant="danger"
          v-for="player in game.players.filter(
            (pl) => remainingTime(pl) <= 0 && isCurrentPlayer(pl._id) && !pl.dropped && !pl.quit
          )"
          :key="player._id"
          :disabled="requestedDrop[player._id]"
          @click="requestDrop(player._id)"
        >
          Drop {{ player.name }}
        </b-btn>
      </div>
      <div
        class="mt-75"
        v-if="gameInfo && gameInfo.settings && gameInfo.settings.length > 0 && game.status === 'active' && settings"
      >
        <h3>
          Settings
          <router-link :to="`/page/${game.game.name}/settings`">
            <b-icon icon="info-circle-fill" font-scale="0.8" />
          </router-link>
        </h3>
        <div
          v-for="pref in gameInfo.settings.filter(
            (setting) => !setting.faction || setting.faction === playerUser.faction
          )"
          :key="pref.name"
        >
          <template v-if="pref.type === 'checkbox'">
            <b-checkbox v-model="settings[pref.name]" @change="postSettings">
              {{ pref.label }}
            </b-checkbox>
          </template>
          <template v-else-if="pref.type === 'select'">
            <b-form-group :label="pref.label" label-cols="auto">
              <b-form-select
                v-model="settings[pref.name]"
                @change="postSettings"
                :options="pref.items.map(({ name, label }) => ({ value: name, text: label }))"
              >
              </b-form-select>
              <template #label>
                <span v-html="oneLineMarked(pref.label)" />
              </template>
            </b-form-group>
          </template>
        </div>
      </div>

      <div class="mt-75" v-if="gameInfo && gameInfo.preferences.length > 0">
        <h3>Preferences</h3>
        <div v-for="pref in preferenceItems" :key="pref.name">
          <b-checkbox v-model="preferences[pref.name]" @change="postPreferences">
            {{ pref.label }}
          </b-checkbox>
        </div>
      </div>

      <div class="mt-75">
        <div class="d-flex align-items-baseline">
          <h3 class="mb-0">Notes</h3>
          <div class="ml-2" style="font-size: smaller">
            (<a href="#" style="font-weight: unset !important" @click.prevent="showNotes = !showNotes">{{
              showNotes ? "hide" : "show"
            }}</a
            >)
          </div>
        </div>
        <b-form-textarea
          class="mt-2"
          style="resize: vertical"
          v-if="showNotes"
          v-model="notes"
          @change="updateNotesDebounce(game._id)"
          rows="3"
          max-rows="8"
          placeholder="You can make plans here..."
          :disabled="!user || !hasReceivedNotes"
        >
        </b-form-textarea>
      </div>

      <div class="mt-75" v-if="gameInfo && gameInfo.expansions.length > 0 && game.game.expansions.length > 0">
        <h3>Expansions</h3>
        <div v-for="expansion in game.game.expansions" :key="expansion">
          <b-badge variant="info" class="mr-1">{{
            gameInfo.expansions.find((xp) => xp.name === expansion).label
          }}</b-badge>
        </div>
      </div>

      <div class="mt-75 thin-scrollbar" v-if="log.length > 0">
        <div class="d-flex align-items-baseline">
          <h3 class="mb-0">Log</h3>
          <div class="ml-2" style="font-size: smaller">
            (<a href="#" style="font-weight: unset !important" @click.prevent="showLog = !showLog">{{
              showLog ? "hide" : "show"
            }}</a
            >)
          </div>
        </div>
        <div class="log mt-2" ref="log" v-if="showLog">
          <div v-for="(item, i) in [...log].reverse()" :key="i" v-html="logToHtml(item)"></div>
        </div>
      </div>

      <div v-if="gameInfo && gameInfo.viewer.replayable" class="mt-75">
        <b-btn variant="info" size="sm" @click="startReplay" v-if="!replayData">Replay</b-btn>
        <div v-else class="d-flex align-items-center">
          <b-btn size="sm" class="mr-1" @click="replayTo(replayData.start)"><b-icon icon="skip-backward-fill" /></b-btn>
          <b-btn size="sm" class="mx-1" @click="replayTo(Math.max(replayData.start, replayData.current - 1))"
            ><b-icon icon="skip-start-fill"
          /></b-btn>
          <span
            class="mx-1 text-center"
            style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
          >
            {{ replayData.current }} / {{ replayData.end }}
          </span>
          <b-btn size="sm" class="mx-1" @click="replayTo(Math.min(replayData.end, replayData.current + 1))"
            ><b-icon icon="skip-end-fill"
          /></b-btn>
          <b-btn size="sm" class="mx-1" @click="replayTo(replayData.end)"><b-icon icon="skip-forward-fill" /></b-btn>
          <b-btn size="sm" class="ml-1" @click="endReplay"><b-icon icon="stop-fill" variant="danger" /></b-btn>
        </div>
      </div>

      <div
        class="mt-75"
        v-if="
          gameInfo &&
          gameInfo.options.length > 0 &&
          game.game.options &&
          gameInfo.options.some((x) => !!game.game.options[x.name])
        "
      >
        <h3>Setup options</h3>
        <div v-for="pref in gameInfo.options.filter((x) => !!game.game.options[x.name])" :key="pref.name">
          <b-badge variant="secondary" class="mr-1">
            <span v-html="oneLineMarked(pref.label)" v-if="pref.type === 'checkbox'" />
            <span
              v-else-if="
                pref.type === 'select' && pref.items && pref.items.some((x) => x.name === game.game.options[pref.name])
              "
              v-html="
                oneLineMarked(pref.label + ': ' + pref.items.find((x) => x.name === game.game.options[pref.name]).label)
              "
            />
          </b-badge>
        </div>
      </div>
    </portal>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import type { Game } from "../types";
import debounce from "lodash/debounce";
import { isEqual, keyBy } from "lodash";
import { timerTime, oneLineMarked, handleError } from "../utils";
import DOMPurify from "dompurify";
import { PlayerInfo } from "@lib/game";

@Component({
  created() {
    console.log("game sidebar created");
    this.loadNotes();
    this.loadPreferences();

    const interval = setInterval(() => {
      if (!document.hidden) {
        this.secondsCounter += 1;
      }
    }, 1000);
    this.$once("hook:beforeDestroy", () => clearInterval(interval));

    this.showLog = !!localStorage.getItem("show-log");
    this.showNotes = localStorage.getItem("show-notes") !== "false";
  },
})
export default class GameSidebar extends Vue {
  @Prop()
  game!: Game;

  @Prop()
  players!: Array<{ id: string; elo: number; name: string }>;

  @Prop({ default: () => [] })
  log: string[];

  @Prop({ default: null })
  replayData: { stard: number; end: number; current: number } | null;

  showLog = false;
  showNotes = false;

  settings = null;
  requestedDrop: Record<string, boolean> = {};

  notes = "";

  get preferenceItems() {
    let data = this.gameInfo?.preferences;

    if (data && this.gameInfo?.viewer?.alternate?.url) {
      data = [{ name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null }, ...data];
    }

    return data;
  }

  get preferences() {
    return this.$gameSettings.settings(this.game?.game.name)?.preferences ?? {};
  }

  get user() {
    return this.$store.state.user;
  }

  get playerUser() {
    return this.game.players.find((pl) => pl._id === this.user?._id);
  }

  get activePlayers() {
    return this.game.players.filter((pl) => this.game.currentPlayers?.some((pl2) => pl._id === pl2._id));
  }

  status(playerId: string) {
    return this.$store.state.playerStatus.find((pl) => pl._id === playerId)?.status;
  }

  playerElo(playerId: string) {
    return this.players.find((pl) => pl.id === playerId)?.elo ?? 0;
  }

  get gameInfo() {
    if (!this.game) {
      return null;
    }
    return this.$gameInfo.info(this.game.game.name, this.game.game.version);
  }

  get alwaysActive() {
    return this.game.options.timing.timer?.start === this.game.options.timing.timer?.end;
  }

  timerTime = timerTime;

  logToHtml(log: string) {
    return DOMPurify.sanitize(oneLineMarked(log));
  }

  get currentPlayersById() {
    console.log("current players by id");
    return keyBy(this.game?.currentPlayers ?? [], "_id");
  }

  isCurrentPlayer(id: string) {
    return this.game.status !== "ended" && !!this.currentPlayersById[id];
  }

  remainingTime(player: PlayerInfo) {
    const currentPlayer = this.currentPlayersById[player._id];
    if (currentPlayer) {
      // Trick to update every second
      return Math.floor((new Date(currentPlayer.deadline).getTime() - Date.now() + (this.secondsCounter % 1)) / 1000);
    }
    return Math.max(player.remainingTime, 0);
  }

  updateNotesDebounce = debounce(this.updateNotes.bind(this), 800, { leading: false, trailing: true });

  private async updateNotes(gameId: string) {
    if (gameId !== this.game._id) {
      return;
    }
    await this.$axios.post(`/game/${this.game._id}/notes`, { notes: this.notes });
  }

  async postPreferences() {
    if (!this.$store.state.user) {
      return;
    }
    await this.$axios.post(
      `/account/games/${this.game.game.name}/preferences/${this.game.game.version}`,
      this.preferences
    );
  }

  async postSettings() {
    if (!this.$store.state.user) {
      return;
    }
    await this.$axios.post(`/gameplay/${this.game._id}/settings`, this.settings);
  }

  async voteCancel() {
    const doIt = await this.$bvModal.msgBoxConfirm(
      "This vote cannot be taken back. If all active players vote to cancel, the game will be cancelled."
    );

    if (doIt) {
      await this.$axios.post(`/game/${this.game._id}/cancel`).catch(handleError);
    }
  }

  async quit() {
    await this.$axios.post(`/game/${this.game._id}/quit`).catch(handleError);
  }

  async requestDrop(playerId: string) {
    await this.$axios
      .post(`/game/${this.game._id}/drop/${playerId}`)
      .then(() => (this.requestedDrop[playerId] = true), handleError);
  }

  startReplay() {
    this.$emit("replay:start");
  }

  replayTo(dest: number) {
    this.$emit("replay:to", dest);
  }

  endReplay() {
    this.$emit("replay:end");
  }

  @Watch("game")
  @Watch("user")
  async loadNotes() {
    this.hasReceivedNotes = false;
    if (this.game && this.user) {
      this.receivedNotes = await this.$axios.get(`/game/${this.game._id}/notes`).then((r) => r.data);
      this.notes = this.receivedNotes;
      this.hasReceivedNotes = true;
    }
  }

  @Watch("game.game.name")
  @Watch("user._id")
  async loadPreferences() {
    this.$gameSettings.loadSettings(this.game?.game.name);
  }

  @Watch("game._id")
  @Watch("game.status")
  @Watch("user._id", { immediate: true })
  async loadSettings() {
    if (this.game?.status !== "active" || !this.playerUser) {
      this.settings = null;
      return;
    }
    const gameInfo = this.$gameInfo.info(this.game.game.name, this.game.game.version);
    if (!gameInfo || gameInfo.settings?.length > 0) {
      this.settings = await this.$axios.get(`/gameplay/${this.game._id}/settings`).then((r) => r.data);
    } else {
      this.settings = null;
    }
  }

  @Watch("game._id")
  resetRequests() {
    this.requestedDrop = {};
  }

  @Watch("notes")
  saveNotesIfNeeded() {
    if (this.notes !== this.receivedNotes) {
      delete this.receivedNotes;
      this.updateNotesDebounce(this.game._id);
    }
  }

  @Watch("showLog")
  onShowLogChanged() {
    localStorage.setItem("show-log", this.showLog ? "true" : "");
  }

  @Watch("showNotes")
  onShowNotesChanged() {
    localStorage.setItem("show-notes", this.showNotes ? "true" : "false");
  }

  hasReceivedNotes = false;
  receivedNotes = "";
  secondsCounter = 0;
  oneLineMarked = oneLineMarked;
}
</script>
<style lang="scss">
.your-turn {
  color: #25ee25;
}

.sidebar {
  .player-row.active .player-name {
    color: #25ee25 !important;
  }
  .player-name {
    &.dropped {
      text-decoration: line-through;
    }
  }
  .player-avatar {
    width: 1.8em;
    height: 1.8em;

    &.active {
      box-shadow: 0 0 3px #25ee25;
    }

    .vp {
      z-index: 100;
      width: 18px;
      border-radius: 5px;
      font-size: 0.6em;

      &.online {
        background-color: #25ee25;
      }

      &.away {
        background-color: orange;
      }
    }
  }

  .log {
    height: 300px;
    overflow-y: scroll;

    margin-top: 4px;
    padding-left: 12px;
    border: 1px solid rgb(51, 51, 51);
    border-radius: 8px;
    padding-right: 12px;
  }
}
</style>
