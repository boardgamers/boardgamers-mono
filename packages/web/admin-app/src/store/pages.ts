import { Page } from "@bgs/types/page";
import { defineStore } from "pinia";
import { ref } from "vue-demi";

export const usePageStore = defineStore("pages", () => {
  const pages = ref<Page[]>([]);

  return {
    pages,
  };
});
