<script lang="ts">
	import { resolve } from "$app/paths";
	import { m } from "@/lib/i18n/messages";
</script>

<footer
	class="mt-6 flex min-h-[60px] w-full items-center border-t border-gray-200 bg-gray-100 px-4 py-4 dark:border-gray-700 dark:bg-gray-900"
>
	<div class="mx-auto flex flex-row flex-wrap gap-4 text-sm">
		<a href="https://forum.boardgamers.space" class="text-gray-500 underline hover:text-primary dark:text-gray-400"
			>{m.footer_forum()}</a
		>
		<a href="mailto:contact@boardgamers.space" class="text-gray-500 underline hover:text-primary dark:text-gray-400"
			>{m.footer_contact()}</a
		>
		<a
			data-sveltekit-preload-data="hover"
			href={resolve("/(app)/feedback")}
			class="text-gray-500 underline hover:text-primary dark:text-gray-400">{m.footer_feedback()}</a
		>
		<a
			data-sveltekit-preload-data="hover"
			href={resolve("/(app)/page/[part1]", { part1: "source" })}
			class="text-gray-500 underline hover:text-primary dark:text-gray-400">{m.footer_source()}</a
		>
		<a
			data-sveltekit-preload-data="hover"
			href={resolve("/(app)/page/[part1]", { part1: "privacy-policy" })}
			class="text-gray-500 underline hover:text-primary dark:text-gray-400">{m.footer_privacyPolicy()}</a
		>
		<a href="https://docs.boardgamers.space" class="text-gray-500 underline hover:text-primary dark:text-gray-400"
			>{m.footer_docs()}</a
		>
	</div>
</footer>
