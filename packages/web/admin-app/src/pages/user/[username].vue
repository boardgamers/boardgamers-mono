<script setup lang="ts">
import { IUser } from "@bgs/types";
import { pick } from "lodash";
import { ApiError } from "@bgs/types";
import { ref, watch } from "vue-demi";
import { handleError, handleInfo } from "~/utils";
import { get, post } from "~/api/rest";
import VDataTable from "~cdk/VDataTable.vue";

const props = defineProps<{username: string}>();
const gameName = ref("");
const elo = ref(0);
const apiErrors = ref<ApiError[]>([]);
const loading = ref(true);
const user = ref<IUser | void>();

const apiHeaders = [
  { text: "Name", value: "error.name" },
  { text: "Method", value: "request.method" },
  { text: "url", value: "request.url" },
];

async function grantAccess() {
  try {
    await post(`/admin/users/${user.value!._id}/access/grant`, {
      type: "game",
      game: gameName.value,
      version: "latest",
    });
    handleInfo(`Access granted to ${gameName.value}!`);
  }
  catch (err) {
    handleError(err);
  }
}

async function changeElo() {
  try {
    await post(`/admin/users/${user.value!._id}/elo/${gameName.value}`, {
      value: elo.value,
    });
    handleInfo("Elo changed!");
  }
  catch (err) {
    handleError(err);
  }
}

async function confirmUser() {
  try {
    await post(`/admin/users/${user.value!._id}/confirm`, {});
    handleInfo("User confirmed!");
  }
  catch (err) {
    handleError(err);
  }
}

async function login() {
  post("/admin/login-as", { username: user.value!.account.username }).then(({ refreshToken }) => {
    if (location.hostname === "localhost") {
      location.href = `http://localhost:8615/login?refreshToken=${encodeURIComponent(JSON.stringify(refreshToken))}`;
    }
    else {
      location.href
          = `//${
          location.hostname.slice("admin.".length)
        }/login?refreshToken=${
          encodeURIComponent(JSON.stringify(refreshToken))}`;
    }
  }, handleError);
}

// Load user / Api errors
watch(() => props.username, async (username: string) => {
  loading.value = true;

  try {
    user.value = await get(`/admin/users/infoByName/${username}`);

    apiErrors.value = await get(`/admin/users/${user.value!._id}/api-errors`);
  }
  catch (err) {
    handleError(err);
  }
  finally {
    loading.value = false;
  }
}, { immediate: true });

async function updateKarma(value: number) {
  if (!isNaN(value)) {
    await post(`/admin/users/${user.value!._id}`, pick(user.value, "account.karma"));
    handleInfo(`Karma updated to ${value}`);
  }
}
</script>

<template>
  <div>
    <v-card :loading="loading">
      <template #title>
        User management
      </template>
      <v-text-field
        v-if="user"
        v-model.number="user.account.karma"
        label="Karma"
        type="number"
        @change="updateKarma"
      />
      <template #actions>
        <v-btn :disabled="user?.security?.confirmed" @click="confirmUser">
          Confirm user
        </v-btn>
        <v-btn @click="login">
          Log in as
        </v-btn>
      </template>
    </v-card>
    <v-card class="mt-4" :loading="loading">
      <template #title>
        Boardgame management
      </template>
      <v-text-field v-model="gameName" label="Boardgame name" />
      <v-text-field v-model.number="elo" type="number" label="Elo" />
      <template #actions>
        <v-btn @click="grantAccess">
          <mdi-check />
          Grant access
        </v-btn>
        <v-btn @click="changeElo">
          Change elo
        </v-btn>
      </template>
    </v-card>

    <v-card class="mt-4">
      <template #title>
        Api Errors
      </template>
      <v-data-table
        :headers="apiHeaders"
        :items="apiErrors"
        item-key="_id"
        single-expand
        show-expand
        :loading="loading"
      >
        <template #expanded-item="{ item }">
          <td :colspan="apiHeaders.length">
            <pre>{{ JSON.stringify(item, null, 2).replaceAll('\\n', '\n') }}</pre>
          </td>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
