<script setup lang="ts">
import { GameInfo } from "@shared/types/gameinfo";
import { set } from "lodash";
import { useRouter } from "vue-router";
import { post } from "~/api/rest";
import VCheckbox from "~cdk/VCheckbox.vue";
import VRow from "~cdk/VRow.vue";
import VSelect from "~cdk/VSelect.vue";
import Editor from "~/components/Editor.vue";

const props = withDefaults(defineProps<{ mode: "new" | "edit"; gameInfo: GameInfo }>(), { mode: "edit" });

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

const rules = ref<typeof Editor>();
const description = ref<typeof Editor>();

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

  setTimeout(() => rules.value?.setMarkdown(data.rules));
  setTimeout(() => description.value?.setMarkdown(data.description));

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
        <h3>
          {{ i > 0 ? "Alternate viewer" : "Viewer" }}
        </h3>
        <v-text-field v-model="viewer.url" label="Viewer URL" required />
        <v-text-field v-model="viewer.topLevelVariable" label="Viewer variable" required />
        <div v-for="variable in ['scripts', 'stylesheets']" :key="variable">
          <v-row v-for="i of viewer.dependencies[variable].map((x, i) => i)" :key="i">
            <v-text-field
              v-model="viewer.dependencies[variable][i]"
              :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} URL`"
              class="flex-grow"
              @click="viewer.dependencies[variable].splice(i, 1)"
            />
            <v-btn icon class="bg-red-600 mt-5">
              <mdi-delete />
            </v-btn>
          </v-row>
          <v-btn class="my-3" @click="viewer.dependencies[variable].push('')">
            <mdi-plus-circle /> Add {{ variable.slice(0, -1) }}
          </v-btn>
        </div>

        <v-checkbox v-model="viewer.replayable" label="Replayable" hide-details />
        <v-checkbox v-model="viewer.fullScreen" label="Fullscreen" hide-details />
        <v-checkbox v-model="viewer.trusted" label="⚠ TRUSTED" hide-details />
      </div>

      <h3>Engine</h3>

      <v-text-field v-model="info.engine.package.name" label="Package name" required />
      <v-text-field v-model="info.engine.package.version" label="Package version" required />
      <v-text-field v-model="info.engine.entryPoint" label="Entry point" required />
      <v-checkbox v-model="info.meta.public" hide-details label="Public" />
      <v-checkbox v-model="info.meta.needOwnership" hide-details label="Need ownership" />

      <input v-show="false" type="submit" />
    </form>

    <h3>Description</h3>
    <editor ref="description" />

    <h3>Rules</h3>
    <editor ref="rules" />

    <h3>Settings</h3>

    <form @submit.prevent="updateGame">
      <div v-for="variable in ['expansions', 'options', 'preferences', 'settings']" :key="variable">
        <div v-for="i of info[variable].map((x, i) => i)" :key="i">
          <v-row>
            <v-text-field
              v-model="info[variable][i].name"
              :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} ID`"
            />
            <v-text-field
              v-model="info[variable][i].label"
              class="flex-grow"
              :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} name`"
            />
            <v-text-field
              v-if="variable === 'settings'"
              v-model.trim="info[variable][i].faction"
              :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} faction`"
            />
            <v-select
              v-if="variable !== 'expansions'"
              v-model="info[variable][i].type"
              :items="[
                { text: 'checkbox', value: 'checkbox' },
                { text: 'select', value: 'select' },
              ]"
              label="Type"
              class="flex-grow"
            ></v-select>
            <v-btn icon class="bg-red-600 mt-5" @click="info[variable].splice(i, 1)">
              <mdi-delete />
            </v-btn>
          </v-row>
          <v-card v-if="info[variable][i].type === 'select'" class="m-4">
            <template #title> Items for {{ info[variable][i].name }} </template>
            <v-row v-for="(item, j) in info[variable][i].items || []" :key="j">
              <v-text-field v-model="item.name" :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} ID`" />
              <v-text-field
                v-model="item.label"
                class="flex-grow"
                :label="`${variable[0].toUpperCase()}${variable.slice(1, -1)} name`"
              />
              <v-btn icon class="bg-red-600 mt-5" @click="info[variable][i].items.splice(j, 1)">
                <mdi-delete />
              </v-btn>
            </v-row>
            <template #action>
              <v-btn @click="info[variable][i].items = [...(info[variable][i].items || []), { name: '', label: '' }]">
                <mdi-plus-circle-outline /> Add item
              </v-btn>
            </template>
          </v-card>
        </div>
        <v-btn class="my-3" @click="info[variable].push({ name: '', label: '', type: 'checkbox', items: null })">
          <mdi-plus-circle /> Add {{ variable.slice(0, -1) }}
        </v-btn>
      </div>

      <v-row>
        <v-btn v-if="mode === 'edit'" color="secondary" @click="duplicate">
          <mdi-content-duplicate /> Duplicate to next version
        </v-btn>
        <v-btn color="primary" type="submit"> <mdi-floppy /> Save </v-btn>
      </v-row>
    </form>
  </div>
</template>
<style scoped>
h3 {
  @apply font-bold my-4;
}
</style>
