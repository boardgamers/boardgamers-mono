<script setup lang="ts">
import ToastUIEditor from "@toast-ui/editor";
import { GameInfo } from "@shared/types/gameinfo";
import { PropType, ref, watch } from "vue";
import { set } from "lodash";
import { useRouter } from "vue-router";
import { post } from "~/api/rest";

const props = defineProps({ mode: { type: String as PropType<"new" | "edit">, default: "edit" }, gameInfo: { type: Object as PropType<GameInfo> } });

const emit = defineEmits<{(e: "update:game", value: GameInfo): void}>();

const info = ref<GameInfo>({
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
});

const rules = ref<ToastUIEditor>();
const description = ref<ToastUIEditor>();

const updateGame = () => {
  info.value.rules = rules.value!.getMarkdown();
  info.value.description = description.value!.getMarkdown();

  // Remove empty faction strings
  for (const setting of info.value.settings ?? []) {
    if (!setting.faction) {
      delete setting.faction;
    }
  }

  emit("update:game", info.value);
};

const router = useRouter();

const duplicate = async () => {
  await post(`/admin/gameinfo/${info.value._id.game}/${info.value._id.version + 1}`, {
    ...info,
    meta: { public: false },
  });
  router.push({
    name: "game",
    params: { version: `${info.value._id.version + 1}`, game: info.value._id.game },
  });
};

watch(() => props.gameInfo, (gameInfo) => {
  if (!gameInfo) {
    return;
  }

  const data: GameInfo = JSON.parse(JSON.stringify(gameInfo));

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

  setTimeout(() => rules.value?.setMarkdown(data.rules, false));
  setTimeout(() => rules.value?.setMarkdown(data.description, false));

  info.value = data;
}, { immediate: true });
</script>

<template>
  <div>
    <form @submit.prevent="updateGame">
      <v-text-field v-model="info.label" label="Game name" required />
      <v-text-field v-model="info._id.game" label="Game ID" required :disabled="mode !== 'new'" />
      <v-text-field v-model="info._id.version" label="Version" required type="number" :disabled="mode !== 'new'" />

      <v-select
        v-model="info.players"
        label="Players"
        required
        multiple
        :items="[2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ text: x + ' players', value: x }))"
      />

      <div v-for="(viewer, i) in [info.viewer, info.viewer.alternate]" :key="i">
        <h3 class="my-4">
          {{ i > 0 ? "Alternate viewer" : "Viewer" }}
        </h3>
        <v-text-field v-model="viewer.url" label="Viewer URL" required />
        <v-text-field v-model="viewer.topLevelVariable" label="Viewer variable" required />
        <div v-for="variable in ['scripts', 'stylesheets']" :key="variable">
          <v-text-field
            v-for="i of viewer.dependencies[variable].map((x, i) => i)"
            :key="i"
            v-model="viewer.dependencies[variable][i]"
            :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} URL`"
            append-outer-icon="mdi-delete"
            @click:append-outer="viewer.dependencies[variable].splice(i, 1)"
          />
          <v-btn color="primary" class="mb-3" @click="viewer.dependencies[variable].push('')">
            <v-icon class="mr-2"> mdi-plus-circle </v-icon>Add {{ variable.slice(0, -1) }}
          </v-btn>
        </div>

        <v-checkbox v-model="viewer.replayable" label="Replayable" hide-details />
        <v-checkbox v-model="viewer.fullScreen" label="Fullscreen" hide-details />
        <v-checkbox v-model="viewer.trusted" label="⚠ TRUSTED" hide-details />
      </div>

      <h3 class="my-4">Engine</h3>

      <v-text-field v-model="info.engine.package.name" label="Package name" required />
      <v-text-field v-model="info.engine.package.version" label="Package version" required />
      <v-text-field v-model="info.engine.entryPoint" label="Entry point" required />
      <v-checkbox v-model="info.meta.public" hide-details label="Public" />
      <v-checkbox v-model="info.meta.needOwnership" hide-details label="Need ownership" />

      <input type="submit" class="d-none" />
    </form>

    <h3 class="my-4">Description</h3>
    <editor ref="description" :options="{ usageStatistics: false }" :initial-value="info.description" />

    <h3 class="my-4">Rules</h3>
    <editor ref="rules" :options="{ usageStatistics: false }" :initial-value="info.rules" />

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
            <v-col v-if="variable !== 'expansions'" cols="auto">
              <v-select
                v-model="info[variable][i].type"
                :items="[
                  { text: 'checkbox', value: 'checkbox' },
                  { text: 'select', value: 'select' },
                ]"
                label="Type"
              ></v-select>
            </v-col>
            <v-col cols="auto">
              <v-btn icon>
                <v-icon @click="info[variable].splice(i, 1)"> mdi-delete </v-icon>
              </v-btn>
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
                <v-col cols="auto">
                  <v-btn icon>
                    <v-icon @click="info[variable][i].items.splice(j, 1)"> mdi-delete </v-icon>
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
            <hr />
            <v-card-actions>
              <v-btn
                color="secondary"
                @click="info[variable][i].items = [...(info[variable][i].items || []), { name: '', label: '' }]"
              >
                <v-icon class="mr-2"> mdi-plus-circle-outline </v-icon> Add item
              </v-btn>
            </v-card-actions>
          </v-card>
        </div>
        <v-btn
          color="primary"
          class="mb-3"
          @click="info[variable].push({ name: '', label: '', type: 'checkbox', items: null })"
        >
          <v-icon class="mr-2"> mdi-plus-circle </v-icon>Add {{ variable.slice(0, -1) }}
        </v-btn>
      </div>

      <v-row>
        <v-col cols="auto">
          <v-btn v-if="mode === 'edit'" color="secondary" @click="duplicate">
            <v-icon class="mr-2"> mdi-content-duplicate </v-icon>Duplicate to next version
          </v-btn>
        </v-col>
        <v-col cols="auto">
          <v-btn color="primary" type="submit"> <v-icon class="mr-2"> mdi-floppy </v-icon>Save </v-btn>
        </v-col>
      </v-row>
    </form>
  </div>
</template>
