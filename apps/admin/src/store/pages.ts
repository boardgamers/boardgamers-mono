import { Page } from "@bgs/types";
import { defineStore } from "pinia";
import { ref } from "vue-demi";

export const usePageStore = defineStore("pages", () => {
  const pages = ref<Page[]>([]);

  return {
    pages,
  };
});
