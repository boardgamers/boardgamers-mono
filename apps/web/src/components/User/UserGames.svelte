<script lang="ts">
	import type { Page } from "@sveltejs/kit";
	import { Card } from "@/modules/cdk";
	import { GameList } from "../Game";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import type { UserFront } from "@bgs/models";

	let { userId }: { userId: string } = $props();

	// The viewer's karma (SSR snapshot) — threaded into the open-games list (#345).
	let viewerKarma = $derived((page.data.user as UserFront | null)?.account?.karma);

	let filter = $derived(page.url.searchParams.get("games") ?? "started");

	const generateAlternative = (page: Page) => {
		const query = new URLSearchParams(page.url.searchParams);

		query.set("games", filter === "open" ? "started" : "open");

		return query.toString();
	};

	let alternativeQuery = $derived("?" + generateAlternative(page));
	let alternativeLink = $derived(
		resolve("/(app)/user/[username]", { username: page.params.username! }) + alternativeQuery
	);
</script>

<Card class="mt-4 border-secondary" header="Games">
	<!-- The CDK Row/Col responsive props are no-ops (everything collapses to `flex-1` on a
	     single `flex-row`), which forced the page ~768px wide on mobile. A real responsive
	     grid stacks the lists on small screens and goes 2-col on `lg`; `min-w-0` on each
	     list lets it shrink instead of overflowing the cell. -->
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		{#if filter === "started"}
			<GameList gameStatus="active" perPage={5} {userId} title="Active games" class="min-w-0" />
			<GameList gameStatus="ended" perPage={5} {userId} title="Finished games" class="min-w-0" />
		{:else}
			<GameList gameStatus="open" perPage={5} {userId} title="Open games" class="min-w-0" {viewerKarma} />
		{/if}
	</div>
	{#snippet footer()}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation -->
		<a href={alternativeLink}>
			{filter === "started" ? "Open games" : "Started games"}
		</a>
	{/snippet}
</Card>
