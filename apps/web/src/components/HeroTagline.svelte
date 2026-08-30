<script lang="ts">
	import { resolve } from "$app/paths";
	import { gameInfosState } from "@/lib/game-info.svelte";
	import { heroGames, heroListParts, taglineParts } from "@/lib/hero-tagline";
	import { m } from "@/lib/i18n/messages";
	import { currentLocale } from "@/lib/i18n/messages.svelte";
	import { getLocale } from "@/lib/paraglide/runtime.js";

	// Most-liked publicly playable games, each linking to its boardgame page. EVERY map
	// entry is passed (not just the `/latest` picks): for a beta tester the picked latest
	// can be their private-beta version while older public versions exist, and heroGames
	// must see those to keep the game cited. `$derived.by` because gameInfosState reads
	// reactive state — a like toggle re-derives the list.
	let games = $derived.by(() => heroGames(Object.values(gameInfosState())));
	let tagline = $derived(taglineParts(m.home_hero_tagline));
	// Localized "A, B and C" separators. Same pattern as the `m` proxy: the tracked
	// currentLocale() read makes a client-side language switch re-derive; getLocale()
	// resolves the request's locale during SSR (where currentLocale would return the
	// module-global default).
	let parts = $derived.by(() => {
		void currentLocale();
		return heroListParts(games, getLocale());
	});
</script>

<!-- Rendered without inter-expression whitespace: the message split and the
     Intl.ListFormat parts carry their own spacing. -->
<p class="text-lg font-light">
	{tagline.before}{#each parts as part, i (i)}{#if part.game}<a
				class="no-link font-semibold text-accent dark:text-accent-lighter"
				href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: part.game.id })}>{part.text}</a
			>{:else}{part.text}{/if}{/each}{tagline.after}
</p>
