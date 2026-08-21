<script lang="ts">
	import { resolve } from "$app/paths";
	import { loadEloRankings, type EloRanking } from "@/lib/elo-rankings.svelte";
	import { countryFlag, countryName } from "@/lib/countries";
	import { Loading, Pagination } from "@/modules/cdk";
	import { createWatcher, handleError } from "@/utils";
	import { untrack } from "svelte";
	import UserAvatar from "./User/UserAvatar.svelte";
	import { m } from "@/lib/i18n/messages";

	let {
		boardgameId,
		top = false,
		perPage = 5,
		serverPagination = false,
		initial = undefined,
		currentPage = $bindable(0),
	}: {
		boardgameId: string;
		top?: boolean;
		perPage?: number;
		/** When true, page changes navigate to /boardgame/[boardgameId]/rankings/[...page] instead of loading client-side. */
		serverPagination?: boolean;
		initial?: { rankings: EloRanking[]; total: number } | void;
		currentPage?: number;
	} = $props();

	// Seed from SSR data once — `initial` is a one-shot prop that never changes after mount.
	let count = $state(untrack(() => initial?.total ?? 0));
	let boardgameElo = $state<EloRanking[]>(untrack(() => initial?.rankings ?? []));
	let loading = $state(untrack(() => !initial));

	let title = $derived(top ? m.boardgame_topRanked() : m.boardgame_elo());

	async function load(refresh: boolean) {
		try {
			const result = await loadEloRankings({
				boardgameId,
				count: perPage,
				skip: currentPage * perPage,
				fetchCount: !top && refresh,
			});

			boardgameElo = result.rankings;
			count = refresh ? result.total : count;
		} catch (err) {
			handleError(err);
		} finally {
			loading = false;
		}
	}

	const hasInitial = untrack(() => initial !== undefined);
	const reload = createWatcher(() => load(true), { immediate: !hasInitial });

	$effect(() => {
		boardgameId;
		reload();
	});

	const onPageChange = createWatcher(() => !serverPagination && load(false));

	$effect(() => {
		if (serverPagination && initial) {
			boardgameElo = initial.rankings;
		}
	});

	$effect(() => {
		currentPage;
		onPageChange();
	});
</script>

<div>
	<h3>{title}</h3>
	<Loading {loading}>
		<ul
			class="divide-y divide-accent/80 rounded-lg border border-accent/80 bg-white text-left dark:divide-accent/60 dark:border-accent/60 dark:bg-gray-900"
		>
			{#each boardgameElo as bgElo, pos (bgElo.user._id)}
				<li>
					<a
						href={resolve("/(app)/user/[username]#elo", { username: bgElo.user.name })}
						class="flex w-full items-center px-4 py-2 no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
					>
						<UserAvatar username={bgElo.user.name} userId={bgElo.user._id} size="2rem" />
						<span class="ms-2">
							<b>{pos + 1 + currentPage * perPage}</b> -
							{bgElo.user.name}
							{#if bgElo.user.country}<span title={countryName(bgElo.user.country)}
									>{countryFlag(bgElo.user.country)}</span
								>{/if}
							- <b>{bgElo.elo.value}</b> elo in {bgElo.elo.games}
							{bgElo.elo.games === 1 ? m.common_game() : m.common_game_plural()}
						</span>
					</a>
				</li>
			{/each}
		</ul>
		{#if !top}
			<Pagination
				class="mt-1"
				align="right"
				{count}
				bind:currentPage
				boardgameId={serverPagination ? boardgameId : undefined}
				{perPage}
			/>
		{/if}
	</Loading>
</div>
