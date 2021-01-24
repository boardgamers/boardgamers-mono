<template>
  <v-loading :loading="!game || !gameInfo || !gameInfo.viewer">
    <div v-if="game && gameInfo && open" class="container pb-3">
      <h1 class="mb-3">{{ gameInfo.label }} – Open Game</h1>

      <div class="row" v-if="gameInfo">
        <div class="col-md-6">
          <h2>Description</h2>
          <div v-html="marked(gameInfo.description)" />
        </div>

        <div class="col-md-6">
          <h2>Rules</h2>
          <div v-html="marked(gameInfo.rules)" />
        </div>
      </div>

      <h2>Info</h2>
      <p>
        Game <i>{{ game._id }}</i
        >, created by
        <v-loading :loading="!players" class="d-inline">
          <router-link :to="`/user/${players && players.find((pl) => pl.id === game.creator).name}`">
            {{ players && players.find((pl) => pl.id === game.creator).name }}
          </router-link>
        </v-loading>
        <template v-if="game.options.setup.seed || (game.options.meta && game.options.meta.minimumKarma)">
          <br />
          <small class="text-muted">
            <span
              v-if="game.options.meta && typeof game.options.meta.minimumKarma === 'number'"
              title="Minimum karma to join the game"
            >
              ☯️ {{ game.options.meta.minimumKarma }}</span
            >
            <span v-if="game.options.setup.seed" title="Game seed"> 🌱 {{ game.options.setup.seed }}</span>
            <span class="pl-1" title="Timezone"> <b-icon icon="clock-history" /> {{ shortPlayTime }}</span>
          </small>
        </template>
      </p>

      <div v-if="game.options.timing.scheduledStart" class="mb-3">
        <b
          >Game is scheduled to start on {{ game.options.timing.scheduledStart | niceDate }} at
          {{ new Date(game.options.timing.scheduledStart).toLocaleTimeString() }}</b
        >
      </div>

      <h3>Timer</h3>

      <div>
        {{ game.options.timing.timePerGame | duration }} per player, with an additional
        {{ game.options.timing.timePerMove | duration }} per move
      </div>
      <div>Timer {{ playTime }}</div>

      <div class="mt-3" v-if="gameInfo && gameInfo.expansions.length > 0 && game.game.expansions.length > 0">
        <h3>Expansions</h3>
        <div v-for="expansion in game.game.expansions" :key="expansion">
          <b-badge variant="info">{{ gameInfo.expansions.find((xp) => xp.name === expansion).label }}</b-badge>
        </div>
      </div>

      <div class="mt-3">
        <h3>Setup options</h3>

        <b-badge variant="secondary" v-if="game.options.setup.randomPlayerOrder" class="mr-1">
          Random player order
        </b-badge>
        <template v-for="pref in gameInfo.options.filter((x) => !!(game.game.options || {})[x.name])">
          <b-badge variant="secondary" class="mr-1" :key="pref.name">
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
        </template>
      </div>

      <v-loading :loading="!players" class="my-3">
        <div v-if="players">
          <h3>Players</h3>
          <div v-if="game.players.length > 0" class="mb-2">
            <div v-for="player in game.players" :key="player._id">
              -
              <router-link :to="`/user/${players.find((pl) => pl.id === player._id).name}`">
                {{ players.find((pl) => pl.id === player._id).name }}
              </router-link>
              - {{ players.find((pl) => pl.id === player._id).elo }} elo
            </div>
          </div>
          <p>Waiting on {{ (game.options.setup.nbPlayers - game.players.length) | pluralize("more player") }}</p>
        </div>
      </v-loading>
      <button class="btn btn-warning" v-if="user && hasPlayer(user._id)" @click="modalShow = true">Leave</button>
      <button class="btn btn-secondary" v-else @click="join">Join!</button>
      <b-modal
        v-if="user && hasPlayer(user._id)"
        v-model="modalShow"
        size="md"
        @ok="unjoin"
        :title="'Leave ' + gameId"
        ok-title="Leave"
      >
        Are you sure you want to leave this game?
      </b-modal>
    </div>
    <div v-else-if="game && gameInfo && gameInfo.viewer">
      <v-loading v-if="!stateSent" :loading="true" />
      <iframe
        id="game-iframe"
        ref="game"
        sandbox="allow-scripts allow-same-origin"
        :class="{ 'd-none': !stateSent, fullScreen: gameInfo.viewer.fullScreen }"
        v-bind="options"
      />
    </div>
    <ChatRoom
      v-if="game && (!open || players)"
      :room="gameId"
      :participants="chatParticipants"
      :me="user ? user._id : null"
    />
    <GameSidebar
      :game="game"
      :players="players"
      :log="log"
      @replay:start="startReplay"
      @replay:end="endReplay"
      @replay:to="replayTo"
      :replayData="replayData"
    />
  </v-loading>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from "vue-property-decorator";
import { handleError, handleInfo, timerTime, oneLineMarked } from "@/utils";
import { IGame } from "@lib/game";
import { IUser } from "@lib/user";
import ChatRoom from "../components/ChatRoom.vue";
import marked from "marked";
import GameSidebar from "../components/GameSidebar.vue";

@Component<Game>({
  created(this: Game) {
    const handleMessage = (event: MessageEvent) => {
      this.handleGameMessage(event);
    };
    window.addEventListener("message", handleMessage);
    this.$once("hook:beforeDestroy", () => window.removeEventListener("message", handleMessage));

    const handleGameUpdate = (when: string) => {
      this.handleGameLastUpdate(new Date(when));
    };
    this.$ws.on("game:lastUpdate", handleGameUpdate);
    this.$once("hook:beforeDestroy", () => this.$ws.off("game:lastUpdate", handleGameUpdate));
  },
  computed: {
    chatParticipants(this: Game) {
      return this.game.players.map((pl) => ({
        id: pl._id,
        name: pl.name,
        imageUrl: pl.faction ? `/images/factions/icons/${pl.faction + ".svg"}` : `/api/user/${pl._id}/avatar`,
      }));
    },
  },
  components: {
    ChatRoom,
    GameSidebar,
  },
})
export default class Game extends Vue {
  game: IGame = null;
  log: string[] = [];

  get preferences() {
    return this.$gameSettings.settings(this.game?.game.name)?.preferences ?? {};
  }

  get gameInfo() {
    if (!this.game) {
      return null;
    }
    return this.$gameInfo.info(this.game.game.name, this.game.game.version);
  }

  modalShow = false;
  stateSent = false;
  players = [];

  replayData: { stard: number; end: number; current: number } | null = null;

  get lastUpdated() {
    return new Date(this.game?.updatedAt ?? null);
  }

  async loadGame() {
    const id = this.gameId;

    try {
      const [data, players] = await Promise.all([
        this.$axios.get(`/gameplay/${this.gameId}`).then((r) => r.data),
        this.$axios.get(`/game/${this.gameId}/players`).then((r) => r.data),
      ]);

      if (id === this.gameId) {
        console.log("updating game", data);
        this.game = data;
        this.players = players;

        this.postGamedata();
      }
    } catch (err) {
      handleError(err);
    }
  }

  async addMove(move: string) {
    const id = this.gameId;

    console.log("adding move", move);
    const { game, log } = await this.$axios.post(`/gameplay/${this.gameId}/move`, { move }).then((r) => r.data);

    if (id === this.gameId && !(game.updatedAt < this.game.updatedAt)) {
      this.updateGameMetaData(game);
      this.postGameLog(log);
    }
  }

  get activeGames() {
    return this.$store.state.activeGames;
  }

  get open() {
    // Set open to false when game is active -> auto refresh
    return this.game.options.setup.nbPlayers !== this.game.players.length;
  }

  get user(): IUser {
    return this.$store.state.user;
  }

  get gameId(): string {
    return this.$route.params.gameId;
  }

  hasPlayer(id: string) {
    return this.game && this.game.players.some((pl) => pl._id === id);
  }

  async join() {
    if (!this.user) {
      this.$router.push({ path: "/login", query: { redirect: this.$route.fullPath } });
      return;
    }

    if (this.game.options.timing.timePerGame <= 24 * 3600) {
      const reallyJoin = await this.$bvModal.msgBoxConfirm(
        "This game has a short duration. You need to keep yourself available in order to play the game until the end."
      );

      if (!reallyJoin) {
        return;
      }
    }

    this.$axios.post(`/game/${this.gameId}/join`).then(({ data: game }) => (this.game = game), handleError);
  }

  unjoin() {
    this.$axios.post(`/game/${this.gameId}/unjoin`).then(() => this.$router.push("/"), handleError);
  }

  gameIframe() {
    return document.querySelector("#game-iframe") as HTMLIFrameElement;

    // To get the store data:
    // Remove the sandbox attribute and:
    // store = document.getElementById("game-iframe").contentDocument.querySelector(".container-fluid").__vue__.$children[0].$store
  }

  async handleGameMessage(event: MessageEvent) {
    try {
      if (event.data.type === "gameReady") {
        console.log("game ready, posting user & pref");
        this.postUser();
        this.postPreferences();
        this.postGamedata();
      } else if (event.data.type === "gameHeight") {
        this.gameIframe().height =
          "" +
          Math.max(
            +window.getComputedStyle(this.gameIframe(), null).getPropertyValue("min-height").replace(/px/, ""),
            +event.data.height
          );
      } else if (event.data.type === "playerClick") {
        this.$router.push({ path: "/user/" + encodeURIComponent(event.data.player.name) });
      } else if (event.data.type === "gameMove") {
        await this.addMove(event.data.move);
      } else if (event.data.type === "displayReady") {
        this.stateSent = true;
      } else if (event.data.type === "fetchState") {
        this.game = await this.$axios.get(`/gameplay/${this.gameId}`).then((r) => r.data);
        this.postGamedata();
      } else if (event.data.type === "fetchLog") {
        const logData = await this.$axios
          .get(`/gameplay/${this.gameId}/log`, { params: event.data.data })
          .then((r) => r.data);
        this.postGameLog(logData);
      } else if (event.data.type === "addLog") {
        this.log.push(...event.data.data);
      } else if (event.data.type === "replaceLog") {
        this.log = event.data.data;
        console.log("new log", this.log);
      } else if (event.data.type === "replay:info") {
        this.replayData = event.data.data;
      }
    } catch (err) {
      handleError(err);
    }
  }

  async handleGameLastUpdate(lastUpdated: Date) {
    // console.log("update received", lastUpdated, this.lastUpdated, this.gameDataLastUpdated);
    if (lastUpdated > this.lastUpdated) {
      console.log("loading game");

      try {
        if (!this.game?.data || !this.stateSent) {
          this.game = await this.$axios.get(`/gameplay/${this.gameId}`).then((r) => r.data);
          this.postGamedata();
          return;
        }

        this.postUpdatePresent();

        const filteredGameData: IGame = await this.$axios.get(`/game/${this.gameId}`).then((r) => r.data);

        this.updateGameMetaData(filteredGameData);
      } catch (err) {
        handleError(err);
      }
    }
  }

  updateGameMetaData(game: IGame) {
    console.log("update game meta data");
    if (game.updatedAt <= this.lastUpdated) {
      return;
    }

    this.game = { ...game, data: this.game?.data };
  }

  startReplay() {
    this.gameIframe()?.contentWindow?.postMessage({ type: "replay:start" }, "*");
  }

  replayTo(dest: number) {
    this.gameIframe()?.contentWindow?.postMessage({ type: "replay:to", to: dest }, "*");
  }

  endReplay() {
    this.gameIframe()?.contentWindow?.postMessage({ type: "replay:end" }, "*");
    this.replayData = null;
  }

  @Watch("gameId", { immediate: true })
  onGameIdUpdated() {
    console.log("resetting game");
    this.game = null;
    this.stateSent = false;
    this.log = [];
    this.$ws.game = this.gameId;
    this.loadGame();
    // this.gameIframe().contentWindow.postMessage({type: "reload"}, "*");
  }

  @Watch("game", { immediate: true })
  async onGameUpdated(val: any) {
    console.log("on game updated", val);
    if (this.game) {
      console.log("loading game info");
      await this.$gameInfo.loadGameInfo(this.game.game.name, this.game.game.version);

      const isActive = this.game.currentPlayers?.some((pl) => pl._id === this.user?._id);
      this.$store.commit(isActive ? "addActiveGame" : "removeActiveGame", this.game._id);
    }
  }

  @Watch("user")
  postUser() {
    if (this.gameIframe()) {
      const index = this.game.players.findIndex((pl) => pl._id === this.user?._id);
      const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
      this.gameIframe().contentWindow.postMessage(message, "*");
    }
  }

  @Watch("preferences", { deep: true })
  postPreferences() {
    if (this.gameIframe()) {
      this.gameIframe().contentWindow.postMessage({ type: "preferences", preferences: this.preferences }, "*");
    }
  }

  postGamedata() {
    if (!this.game?.data) {
      console.log("no game data to post");
      return;
    }

    this.gameIframe()?.contentWindow.postMessage({ type: "state", state: this.game.data }, "*");
  }

  postUpdatePresent() {
    this.gameIframe()?.contentWindow.postMessage({ type: "state:updated" }, "*");
  }

  postGameLog(logObject: { start: number; end?: number; data: any }) {
    this.gameIframe()?.contentWindow.postMessage({ type: "gameLog", data: logObject }, "*");
  }

  get playTime() {
    if (this.game.options.timing.timer?.start !== undefined) {
      return `active between ${timerTime(this.game.options.timing.timer?.start)} and ${timerTime(
        this.game.options.timing.timer?.end
      )}`;
    } else {
      return "always active";
    }
  }

  get shortPlayTime() {
    if (this.game.options.timing.timer?.start !== this.game.options.timing.timer?.end) {
      return `${timerTime(this.game.options.timing.timer?.start)}-${timerTime(this.game.options.timing.timer?.end)}`;
    } else {
      return "24h";
    }
  }

  get resourcesLink() {
    return location.hostname === "localhost"
      ? `//localhost:50804`
      : `//resources.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`; // + "?refreshToken=" + this.$store.jwt.refreshToken.code
  }

  marked = marked;
  oneLineMarked = oneLineMarked;

  get options() {
    if (!this.gameInfo) {
      return {};
    }
    if (this.gameInfo.viewer.trusted) {
      return {
        srcdoc: this.iframeContent,
      };
    } else {
      return {
        src: `${this.resourcesLink}/game/${this.gameInfo._id.game}/${this.gameInfo._id.version}/iframe?alternate=${
          this.preferences.alternateUI ? 1 : 0
        }`,
      };
    }
  }

  @Watch("preferences.alternateUI")
  onAlternateUIChanged(newVal, oldVal) {
    if (!!newVal !== !!oldVal) {
      console.log("alternate UI changed");
      this.stateSent = false;
    }
  }

  get iframeContent() {
    const gameInfo = this.gameInfo;
    return `
    <html>
      <head>
        <meta charset="UTF-8">
        ${gameInfo.viewer.dependencies.scripts.map((dep) => `<${"script"} src='${dep}'></${"script"}>`).join("\n")}
        <${"script"} src='${gameInfo.viewer.url}' type='text/javascript'> </${"script"}>
        ${gameInfo.viewer.dependencies.stylesheets
          .map((dep) => `<link type='text/css' rel='stylesheet' href='${dep}'></link>`)
          .join("\n")}
      </head>
      <body>
        <div id='app'>
        </div>
      </body>
      <${"script"} type='text/javascript'>
        const gameObj = window.${gameInfo.viewer.topLevelVariable}.launch('#app');
        window.addEventListener('message', event => {
          console.log('received message from controller', event.data.type, JSON.parse(JSON.stringify(event.data)));
          switch (event.data.type) {
            case 'state': {
              console.log('updating state', event.data.state);
              gameObj.emit('state', event.data.state);
              parent.postMessage({type: 'displayReady'}, '*');
              break;
            }
            case 'state:updated': {
              console.log('receiving state:updated event');
              gameObj.emit('state:updated');
              break;
            }
            case 'reload': {
              consolg.log('reloading game');
              window.location.reload();
              break;
            }
            case 'gameLog': {
              console.log('receiving log', event.data.data);
              gameObj.emit('gamelog', event.data.data);
              break;
            }
            case 'player':
            case 'preferences': {
              gameObj.emit(event.data.type, event.data[event.data.type]);
              break;
            }
          }
        });
        gameObj.on('move', move => {
          parent.postMessage({type: 'gameMove', move}, '*');
        });
        gameObj.on('fetchState', () => {
          parent.postMessage({type: 'fetchState'}, '*');
        });
        gameObj.on('fetchLog', data => {
          parent.postMessage({type: 'fetchLog', data}, '*');
        });
        gameObj.on('addLog', data => {
          parent.postMessage({type: 'addLog', data}, '*');
        });
        gameObj.on('replaceLog', data => {
          parent.postMessage({type: 'replaceLog', data}, '*');
        });
        gameObj.on('player:clicked', player => {
          console.log('player clicked', player);
          parent.postMessage({type: 'playerClick', player}, '*');
        });

        // Get height of document
        function getDocHeight() {
          // const body = document.body;
          // const html = document.documentElement;
          // console.log(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);

          return document.body.scrollHeight;
        }

        parent.postMessage({type: 'gameReady'}, '*');

        if (!${gameInfo.viewer.fullScreen}) {
          setInterval(() => {if (!document.hidden) {parent.postMessage({type: 'gameHeight', height: getDocHeight()}, '*');}}, 250);
        }
      </${"script"}>
    </html>`;
  }
}

function b64EncodeUnicode(str) {
  // first we use encodeURIComponent to get percent-encoded UTF-8,
  // then we convert the percent encodings into raw bytes which
  // can be fed into btoa.
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function toSolidBytes(match, p1) {
      return String.fromCharCode(+("0x" + p1));
    })
  );
}
</script>

<style lang="scss">
@import "../stylesheets/variables.scss";

#game-iframe {
  border: 0;
  width: calc(100% + 30px);
  margin-left: -15px;
  margin-right: -15px;
  margin-top: -$navbar-margin;
  margin-bottom: -6px;
  min-height: calc(100vh - #{$navbar-height});
}
</style>
