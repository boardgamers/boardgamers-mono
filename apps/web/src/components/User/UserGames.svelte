<script lang="ts">
	import type { Page } from "@sveltejs/kit";
	import { Card, Col, Row } from "@/modules/cdk";
	import { GameList } from "../Game";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";

	let { userId }: { userId: string } = $props();

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
	<Row class="gap-4">
		{#if filter === "started"}
			<Col lg={6}>
				<GameList gameStatus="active" perPage={5} {userId} title="Active games" />
			</Col>
			<Col lg={6}>
				<GameList gameStatus="ended" perPage={5} {userId} title="Finished games" />
			</Col>
		{:else}
			<Col lg={6}>
				<GameList gameStatus="open" perPage={5} {userId} title="Open games" />
			</Col>
		{/if}
	</Row>
	{#snippet footer()}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation -->
		<a href={alternativeLink}>
			{filter === "started" ? "Open games" : "Started games"}
		</a>
	{/snippet}
</Card>
