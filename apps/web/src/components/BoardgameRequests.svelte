<script lang="ts">
	import FeedbackLikeButton from "@/components/FeedbackLikeButton.svelte";
	import FeedbackRequestForm from "@/components/FeedbackRequestForm.svelte";
	import IconBoxArrowUpRight from "@/components/icons/IconBoxArrowUpRight.svelte";
	import IconGithub from "@/components/icons/IconGithub.svelte";
	import UsernameLink from "@/components/User/UsernameLink.svelte";
	import { Badge } from "@/modules/cdk";
	import type { FeedbackStatus, GameInfoFront, UserFront } from "@bgs/models";
	import type { FeedbackRequestListing } from "@/routes/(app)/feedback/+page";

	let {
		boardgameId,
		sourceUrl = undefined,
		requests,
		user,
		class: className = "",
	}: {
		boardgameId: string;
		// The game's source repo (GameInfoFront["links"]["source"]) — shown as a subtle
		// "file requests directly" hint next to the heading when set.
		sourceUrl?: string;
		requests: FeedbackRequestListing[];
		user: UserFront | null;
		class?: string;
	} = $props();

	// Local copy so votes + new requests update instantly without a reload. Capturing
	// the initial list is intended: it is client-owned after first render.
	// svelte-ignore state_referenced_locally
	let requestList = $state<FeedbackRequestListing[]>(requests.map((r) => ({ ...r })));

	const byLikesThenNewest = (a: { likeCount?: number; createdAt?: string }, b: typeof a) =>
		(b.likeCount ?? 0) - (a.likeCount ?? 0) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

	const statusBadge: Record<FeedbackStatus, { color: "secondary" | "info" | "success"; label: string }> = {
		open: { color: "secondary", label: "Open" },
		planned: { color: "info", label: "Planned" },
		done: { color: "success", label: "Done" },
		declined: { color: "secondary", label: "Declined" },
	};
</script>

<section
	class="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700 {className}"
	aria-labelledby="game-feedback-heading"
>
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h2
			id="game-feedback-heading"
			class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
		>
			Requests &amp; feedback
		</h2>
		{#if sourceUrl}
			<a
				href={sourceUrl}
				target="_blank"
				rel="external noopener noreferrer"
				class="inline-flex items-center gap-1 text-xs text-gray-500 no-underline hover:text-primary dark:text-gray-400 dark:hover:text-primary-lighter"
			>
				<IconGithub size="0.9em" />
				Game source on GitHub
				<IconBoxArrowUpRight size="0.6em" class="opacity-60" />
			</a>
		{/if}
	</div>
	<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
		Expansions, variants and improvements for this game, most voted first.
	</p>

	{#if requestList.length === 0}
		<p
			class="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400"
		>
			No requests for this game yet — be the first!
		</p>
	{:else}
		<ul class="mt-4 space-y-3">
			{#each requestList as request (request._id)}
				{@const status = statusBadge[request.status ?? "open"]}
				<li class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="font-semibold">{request.title}</h3>
								<Badge color={status.color}>{status.label}</Badge>
							</div>
							{#if request.body}
								<p class="mt-1 text-sm whitespace-pre-line text-gray-600 dark:text-gray-400">{request.body}</p>
							{/if}
						</div>
						<FeedbackLikeButton
							target={{ kind: "feedback", requestId: request._id! }}
							liked={!!request.liked}
							likeCount={request.likeCount ?? 0}
							ssrUser={user}
							onlike={(next) => Object.assign(request, next)}
						/>
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
						{#if request.requestedBy}
							<span>Requested by <UsernameLink username={request.requestedBy} /></span>
						{/if}
						{#if request.forumTid}
							<a href="https://forum.boardgamers.space/topic/{request.forumTid}">Forum discussion</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
		<FeedbackRequestForm
			kind="game"
			game={boardgameId}
			{user}
			heading="Request an expansion or feature"
			titlePlaceholder="New map"
			bodyPlaceholder="How it would work…"
			submitLabel="Submit request"
			oncreated={(created) => {
				created.requestedBy = user?.account.username;
				requestList = [...requestList, created as FeedbackRequestListing].sort(byLikesThenNewest);
			}}
		/>
	</div>
</section>
