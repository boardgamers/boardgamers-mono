<script lang="ts" setup>
import { get } from "~/api/rest";
import { useGameStore } from "~/store/games";
import { usePageStore } from "~/store/pages";

const games = useGameStore();
const pages = usePageStore();

get("/admin/gameinfo").then(data => games.$patch({ games: data }));
get("/admin/page").then(data => pages.$patch({ pages: data }));
</script>
<template>
  <v-navigation-drawer dark :permanent="true" :value="true" left app>
    <v-list>
      <v-list-item to="/">
        <v-list-item-icon>
          <v-icon>mdi-home-outline</v-icon>
        </v-list-item-icon>
        <v-list-item-title>Home</v-list-item-title>
      </v-list-item>

      <v-list-item to="/users">
        <v-list-item-icon>
          <v-icon>mdi-account-multiple</v-icon>
        </v-list-item-icon>
        <v-list-item-title>Users</v-list-item-title>
      </v-list-item>

      <v-list-group prepend-icon="mdi-album">
        <template #activator>
          <v-list-item-content>
            <v-list-item-title>Boardgames</v-list-item-title>
          </v-list-item-content>
        </template>

        <v-list-item to="/game/new">
          <v-list-item-icon>
            <v-icon>mdi-plus-circle</v-icon>
          </v-list-item-icon>
          <v-list-item-title>New game</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-for="game in games.games"
          :key="game._id.game + '-' + game._id.version"
          :to="`/game/${game._id.game}/${game._id.version}`"
        >
          <v-list-item-icon>{{ game._id.version }}</v-list-item-icon>
          <v-list-item-title>{{ game._id.game }}</v-list-item-title>
        </v-list-item>
      </v-list-group>

      <v-list-group prepend-icon="mdi-book-open-page-variant">
        <template #activator>
          <v-list-item-content>
            <v-list-item-title>Pages</v-list-item-title>
          </v-list-item-content>
        </template>

        <v-list-item to="/page/new">
          <v-list-item-icon>
            <v-icon>mdi-file-plus</v-icon>
          </v-list-item-icon>
          <v-list-item-title>New page</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-for="page in pages.pages"
          :key="page._id.name + '-' + page._id.lang"
          :to="`/page/${page._id.name}/${page._id.lang}`"
        >
          <v-list-item-icon>{{ page._id.lang }}</v-list-item-icon>
          <v-list-item-title>{{ page._id.name }}</v-list-item-title>
        </v-list-item>
      </v-list-group>
    </v-list>
  </v-navigation-drawer>
</template>
