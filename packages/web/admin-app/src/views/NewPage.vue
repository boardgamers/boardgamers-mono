<template>
  <div>
    <h2>New page</h2>
    <PageEdit @page:update="update($event)" mode="new" />
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { Page } from "../types";
import { handleError, handleSuccess } from "../utils";
import PageEdit from "../components/PageEdit.vue";

@Component({
  components: { PageEdit },
})
export default class NewGame extends Vue {
  async update(page: Page) {
    try {
      await this.$axios.post(`/admin/page/${page._id.name}/${page._id.lang}`, page);
      handleSuccess("Page created");

      this.$store.commit("pages", await this.$axios.get("/admin/page").then((r) => r.data));
      this.$router.push({ name: "page", params: { lang: page._id.lang, name: page._id.name } });
    } catch (err) {
      handleError(err);
    }
  }
}
</script>
