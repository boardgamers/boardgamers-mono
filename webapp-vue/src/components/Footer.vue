<template>
  <footer class="footer" v-if="!$route.meta || !$route.meta.noFooter">
    <div class="container">
      <div class="row">
        <div class="col-auto">
          <a href="https://forum.boardgamers.space" class="text-muted">Forum</a>
        </div>
        <div class="col-auto">
          <a href="mailto:contact@boardgamers.space" class="text-muted">Contact</a>
        </div>
        <div class="col-auto">
          <router-link to="/page/source" class="text-muted">Source</router-link>
        </div>
        <div class="col-auto">
          <router-link to="/page/privacy-policy" class="text-muted">Privacy policy</router-link>
        </div>
      </div>
    </div>
  </footer>
</template>

<script lang="ts">
import { Component, Prop, Vue } from "vue-property-decorator";
import { User } from "@/types";

@Component
export default class Footer extends Vue {
  get user(): User {
    return this.$store.state.user;
  }
}
</script>

<style lang="scss">
@import "../stylesheets/variables.scss";

html {
  min-height: 100%;
  height: 100%;
}
body {
  min-height: 100%;
  height: 100%;
}
.footer {
  margin-top: $footer-margin;
  width: 100%;
  min-height: $footer-height; /* Set the fixed height of the footer here */
  line-height: $footer-height; /* Vertically center the text there */
  background-color: #f5f5f5;
}
</style>
