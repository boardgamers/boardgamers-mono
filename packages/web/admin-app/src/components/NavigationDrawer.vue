<script lang="ts" setup>
import { get } from "~/api/rest";
import { useGameStore } from "~/store/games";
import { usePageStore } from "~/store/pages";
import VListItem from "~cdk/VListItem.vue";
import VListItemIcon from "~cdk/VListItemIcon.vue";
import VList from "~cdk/VList.vue";
import VListGroup from "~cdk/VListGroup.vue";

const games = useGameStore();
const pages = usePageStore();

get("/admin/gameinfo").then(data => games.$patch({ games: data }));
get("/admin/page").then(data => pages.$patch({ pages: data }));
</script>
<template>
  <div>
    <v-list>
      <v-list-item to="/">
        <v-list-item-icon>
          <carbon-home />
        </v-list-item-icon>
        Home
      </v-list-item>

      <v-list-item to="/users">
        <v-list-item-icon>
          <carbon-user-multiple />
        </v-list-item-icon>
        Users
      </v-list-item>

      <v-list-group>
        <template #activator>
          <v-list-item-icon>
            <mdi-album />
          </v-list-item-icon>
          Boardgames
        </template>

        <v-list-item to="/game/new">
          <v-list-item-icon>
            <mdi-plus-circle />
          </v-list-item-icon>
          New game
        </v-list-item>

        <v-list-item
          v-for="game in games.games"
          :key="game._id.game + '-' + game._id.version"
          :to="`/game/${game._id.game}/${game._id.version}`"
        >
          <v-list-item-icon>{{ game._id.version }}</v-list-item-icon>
          {{ game._id.game }}
        </v-list-item>
      </v-list-group>

      <v-list-group>
        <template #activator>
          <v-list-item-icon>
            <mdi-book-open-page-variant />
          </v-list-item-icon>
          Pages
        </template>

        <v-list-item to="/page/new">
          <v-list-item-icon>
            <mdi-file-plus />
          </v-list-item-icon>
          New page
        </v-list-item>

        <v-list-item
          v-for="page in pages.pages"
          :key="page._id.name + '-' + page._id.lang"
          :to="`/page/${page._id.name}/${page._id.lang}`"
        >
          <v-list-item-icon>{{ page._id.lang }}</v-list-item-icon>
          {{ page._id.name }}
        </v-list-item>
      </v-list-group>
    </v-list>
  </div>
</template>
