<template>
  <div>
    <h2 v-if="page">{{ page._id.name }} - {{ page._id.lang }}</h2>
    <PageEdit :value="page" mode="edit" @page:update="update($event)" v-if="page" />
  </div>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import { handleError, handleSuccess } from "@/utils";
import { Page as IPage } from "../types";
import PageEdit from "../components/PageEdit.vue";

@Component({
  components: {
    PageEdit,
  },
})
export default class Page extends Vue {
  page: IPage | null = null;
  loading = true;

  @Prop()
  name!: string;

  @Prop()
  lang!: string;

  async update(page: IPage) {
    try {
      await this.$axios.post(`/admin/page/${page._id.name}/${page._id.lang}`, page);
      this.page = page;
      handleSuccess("Page updated");
    } catch (err) {
      handleError(err);
    }
  }

  @Watch("name", { immediate: true })
  async routeUpdated() {
    try {
      this.page = await this.$axios.get(`/page/${this.name}/${this.lang}`).then((r) => r.data);
    } catch (err) {
      handleError(err);
    } finally {
      this.loading = false;
    }
  }
}
</script>
