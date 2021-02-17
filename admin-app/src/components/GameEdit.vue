<template>
  <div>
    <form @submit.prevent="updateGame">
      <v-text-field label="Game name" required v-model="info.label" />
      <v-text-field label="Game ID" required v-model="info._id.game" :disabled="mode !== 'new'" />
      <v-text-field label="Version" required type="number" v-model="info._id.version" :disabled="mode !== 'new'" />

      <v-select
        label="Players"
        required
        multiple
        v-model="info.players"
        :items="[2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ text: x + ' players', value: x }))"
      />

      <div v-for="(viewer, i) in [info.viewer, info.viewer.alternate]" :key="i">
        <h3 class="my-4">{{ i > 0 ? "Alternate viewer" : "Viewer" }}</h3>
        <v-text-field label="Viewer URL" required v-model="viewer.url" />
        <v-text-field label="Viewer variable" required v-model="viewer.topLevelVariable" />
        <div v-for="variable in ['scripts', 'stylesheets']" :key="variable">
          <v-text-field
            v-for="i of viewer.dependencies[variable].map((x, i) => i)"
            :key="i"
            v-model="viewer.dependencies[variable][i]"
            :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} URL`"
            append-outer-icon="mdi-delete"
            @click:append-outer="viewer.dependencies[variable].splice(i, 1)"
          />
          <v-btn color="primary" @click="viewer.dependencies[variable].push('')" class="mb-3"
            ><v-icon class="mr-2">mdi-plus-circle</v-icon>Add {{ variable.slice(0, -1) }}</v-btn
          >
        </div>

        <v-checkbox label="Replayable" hide-details v-model="viewer.replayable" />
        <v-checkbox label="Fullscreen" hide-details v-model="viewer.fullScreen" />
        <v-checkbox label="⚠ TRUSTED" hide-details v-model="viewer.trusted" />
      </div>

      <h3 class="my-4">Engine</h3>

      <v-text-field label="Package name" required v-model="info.engine.package.name" />
      <v-text-field label="Package version" required v-model="info.engine.package.version" />
      <v-text-field label="Entry point" required v-model="info.engine.entryPoint" />
      <v-checkbox hide-details label="Public" v-model="info.meta.public" />
      <v-checkbox hide-details label="Need ownership" v-model="info.meta.needOwnership" />

      <input type="submit" class="d-none" />
    </form>

    <h3 class="my-4">Description</h3>
    <editor :options="{ usageStatistics: false }" ref="description" :initialValue="info.description" />

    <h3 class="my-4">Rules</h3>
    <editor :options="{ usageStatistics: false }" ref="rules" :initialValue="info.rules" />

    <h3 class="my-4">Settings</h3>

    <form @submit.prevent="updateGame">
      <div v-for="variable in ['expansions', 'options', 'preferences', 'settings']" :key="variable">
        <div v-for="i of info[variable].map((x, i) => i)" :key="i">
          <v-row>
            <v-col>
              <v-text-field
                v-model="info[variable][i].name"
                :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} ID`"
              />
            </v-col>
            <v-col>
              <v-text-field
                v-model="info[variable][i].label"
                :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} name`"
              />
            </v-col>
            <v-col v-if="variable === 'settings'">
              <v-text-field
                v-model.trim="info[variable][i].faction"
                :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} faction`"
              />
            </v-col>
            <v-col cols="auto" v-if="variable !== 'expansions'">
              <v-select
                :items="[
                  { text: 'checkbox', value: 'checkbox' },
                  { text: 'select', value: 'select' },
                ]"
                label="Type"
                v-model="info[variable][i].type"
              ></v-select>
            </v-col>
            <v-col cols="auto"
              ><v-btn icon><v-icon @click="info[variable].splice(i, 1)">mdi-delete</v-icon></v-btn>
            </v-col>
          </v-row>
          <v-card v-if="info[variable][i].type === 'select'" class="mb-4">
            <v-card-title>Items for {{ info[variable][i].name }}</v-card-title>
            <v-card-text>
              <v-row v-for="(item, j) in info[variable][i].items || []" :key="j">
                <v-col>
                  <v-text-field
                    v-model="item.name"
                    :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} ID`"
                  />
                </v-col>
                <v-col>
                  <v-text-field
                    v-model="item.label"
                    :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} name`"
                  />
                </v-col>
                <v-col cols="auto"
                  ><v-btn icon><v-icon @click="info[variable][i].items.splice(j, 1)">mdi-delete</v-icon></v-btn>
                </v-col>
              </v-row>
            </v-card-text>
            <hr />
            <v-card-actions>
              <v-btn
                color="secondary"
                @click="info[variable][i].items = [...(info[variable][i].items || []), { name: '', label: '' }]"
                ><v-icon class="mr-2">mdi-plus-circle-outline</v-icon> Add item</v-btn
              >
            </v-card-actions>
          </v-card>
        </div>
        <v-btn
          color="primary"
          @click="info[variable].push({ name: '', label: '', type: 'checkbox', items: null })"
          class="mb-3"
          ><v-icon class="mr-2">mdi-plus-circle</v-icon>Add {{ variable.slice(0, -1) }}</v-btn
        >
      </div>

      <v-row>
        <v-col cols="auto"
          ><v-btn color="secondary" v-if="mode === 'edit'" @click="duplicate"
            ><v-icon class="mr-2">mdi-content-duplicate</v-icon>Duplicate to next version</v-btn
          ></v-col
        >
        <v-col cols="auto"
          ><v-btn color="primary" type="submit"><v-icon class="mr-2">mdi-floppy</v-icon>Save</v-btn></v-col
        >
      </v-row>
    </form>
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { GameInfo } from "../types";
import { set } from "lodash";

@Component
export default class GameEdit extends Vue {
  @Prop()
  gameInfo?: GameInfo;

  info: GameInfo = {
    _id: {
      game: "",
      version: 1,
    },
    label: "",
    rules: "",
    description: "",
    viewer: {
      url: "//cdn.jsdelivr.net/npm/<game>@^1/dist/umd.min.js",
      topLevelVariable: "",
      dependencies: {
        scripts: [],
        stylesheets: [],
      },
      fullScreen: false,
      replayable: false,
      trusted: false,
      alternate: {
        url: "",
        topLevelVariable: "",
        dependencies: {
          scripts: [],
          stylesheets: [],
        },
        fullScreen: false,
        replayable: false,
        trusted: false,
      },
    },
    engine: {
      package: {
        name: "",
        version: "",
      },
      entryPoint: "dist/wrapper.js",
    },
    preferences: [],
    options: [],
    settings: [],
    players: [2, 3, 4],
    expansions: [],
    meta: {
      public: false,
      needOwnership: true,
    },
  };

  @Prop({ default: "edit" })
  mode!: "new" | "edit";

  updateGame() {
    this.info.rules = (this.$refs.rules as any).invoke("getMarkdown");
    this.info.description = (this.$refs.description as any).invoke("getMarkdown");

    // Remove empty faction strings
    for (const setting of this.info.settings ?? []) {
      if (!setting.faction) {
        delete setting.faction;
      }
    }

    this.$emit("game:update", this.info);
  }

  async duplicate() {
    await this.$axios.post(`/admin/gameinfo/${this.info._id.game}/${this.info._id.version + 1}`, {
      ...this.info,
      meta: { public: false },
    });
    this.$router.push({
      name: "game",
      params: { version: "" + (this.info._id.version + 1), game: this.info._id.game },
    });
  }

  @Watch("gameInfo", { immediate: true })
  replaceGameInfo() {
    if (this.gameInfo) {
      const data: GameInfo = JSON.parse(JSON.stringify(this.gameInfo));

      set(data.viewer, "dependencies.scripts", data.viewer.dependencies?.scripts ?? []);
      set(data.viewer, "dependencies.stylesheets", data.viewer.dependencies?.stylesheets ?? []);
      set(data, "engine.package", data.engine?.package ?? { name: "", version: "" });
      set(
        data.viewer,
        "alternate",
        data.viewer.alternate ?? {
          url: "",
          topLevelVariable: "",
          dependencies: {
            scripts: [],
            stylesheets: [],
          },
          fullScreen: false,
          replayable: false,
          trusted: false,
        }
      );
      set(data, "settings", data.settings ?? []);

      for (const item of [...data.options, ...data.preferences]) {
        item.items = item.items || null;
      }

      setTimeout(() => (this.$refs.rules as any).invoke("setMarkdown", data.rules, false));
      setTimeout(() => (this.$refs.description as any).invoke("setMarkdown", data.description, false));

      this.info = data;
    }
  }
}
</script>
