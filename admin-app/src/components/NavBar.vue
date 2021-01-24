<template>
  <v-app-bar dark app :fixed="true" :clipped-left="false" flat>
    <v-spacer></v-spacer>
  </v-app-bar>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";

@Component
export default class NavBar extends Vue {}
</script>
