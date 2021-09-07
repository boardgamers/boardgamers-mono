<script setup lang="ts">
const isDark = useDark();
const toggleDark = useToggle(isDark);

const { t, availableLocales, locale } = useI18n();

const toggleLocales = () => {
  // change to some real logic
  const locales = availableLocales;
  locale.value = locales[(locales.indexOf(locale.value) + 1) % locales.length];
};
</script>

<template>
  <nav class="bg-blue-300 dark:bg-dark-500 shadow-lg py-4 flex px-4 text-xl">
    <a class="icon-btn mx-2 ml-auto" :title="t('button.toggle_langs')" @click="toggleLocales">
      <carbon-language />
    </a>

    <button class="icon-btn mx-2 !outline-none" :title="t('button.toggle_dark')" @click="toggleDark()">
      <carbon-moon v-if="isDark" />
      <carbon-sun v-else />
    </button>
  </nav>
</template>
