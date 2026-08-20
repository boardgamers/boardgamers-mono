<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import FeedbackLikeButton from "@/components/FeedbackLikeButton.svelte";
	import FeedbackRequestForm from "@/components/FeedbackRequestForm.svelte";
	import ForumLinkGate, { type ForumLinkGate as ForumLinkGateHandle } from "@/components/ForumLinkGate.svelte";
	import IconBoxArrowUpRight from "@/components/icons/IconBoxArrowUpRight.svelte";
	import IconGithub from "@/components/icons/IconGithub.svelte";
	import UsernameLink from "@/components/User/UsernameLink.svelte";
	import { post } from "@/lib/api";
	import { account, live } from "@/lib/stores.svelte";
	import { Badge, Button, Input } from "@/modules/cdk";
	import type { FeedbackStatus, UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";
	import type { FeedbackRequestListing, RequestedGame } from "./+page";

	let { data }: PageProps = $props();

	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));

	// Local copies so votes + new requests update instantly without a reload. Capturing
	// the initial `data` is intended: the lists are client-owned after first render.
	// svelte-ignore state_referenced_locally
	let gameRequests = $state<RequestedGame[]>(data.gameRequests.map((r) => ({ ...r })));
	// svelte-ignore state_referenced_locally
	let siteRequests = $state<FeedbackRequestListing[]>(data.siteRequests.map((r) => ({ ...r })));

	const byLikesThenOldest = (a: { likeCount?: number; createdAt?: string }, b: typeof a) =>
		(b.likeCount ?? 0) - (a.likeCount ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

	const statusBadge: Record<FeedbackStatus, { color: "secondary" | "info" | "success"; label: string }> = {
		open: { color: "secondary", label: "Open" },
		planned: { color: "info", label: "Planned" },
		done: { color: "success", label: "Done" },
		declined: { color: "secondary", label: "Declined" },
	};

	// --- Request a game ---
	let gameLabel = $state("");
	let gameDescription = $state("");
	let gameSubmitting = $state(false);
	let gameError = $state("");
	let gameForumGate: ForumLinkGateHandle | undefined = $state();

	async function submitGameRequest() {
		gameError = "";
		gameSubmitting = true;
		try {
			const created = await post<RequestedGame>("/boardgame/request", {
				label: gameLabel.trim(),
				...(gameDescription.trim() ? { description: gameDescription.trim() } : {}),
			});
			// The create response carries the requester's ObjectId (the listing resolves
			// it to a username) — substitute the current user's name for display.
			created.requestedBy = user?.account.username;
			gameRequests = [...gameRequests, created].sort(byLikesThenOldest);
			gameLabel = gameDescription = "";
		} catch (err) {
			if (gameForumGate?.handle(err)) {
				gameForumGate?.stashDraft({ label: gameLabel, description: gameDescription });
			} else {
				// Inline (not just a toast): 409 "already requested" / 429 rate-limit are
				// form errors the user acts on.
				gameError = err instanceof Error ? err.message : "Could not submit the request";
			}
		} finally {
			gameSubmitting = false;
		}
	}
</script>

<div class="container mx-auto max-w-5xl px-4 py-8">
	<h1>Feedback &amp; requests</h1>
	<p class="mt-2 text-gray-600 dark:text-gray-400">
		Vote with your meeple for the games and features you want to see on Boardgamers. Found a bug? Tell us on
		<a href="https://discord.gg/vpP4Q7R">Discord</a> or via <a href="mailto:contact@boardgamers.space">email</a>.
	</p>

	<div class="mt-6 grid gap-6 lg:grid-cols-2">
		<section id="game-requests" aria-labelledby="game-requests-heading">
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h2 id="game-requests-heading">Game requests</h2>
				<a
					href="https://docs.boardgamers.space/guide/adding-a-game"
					target="_blank"
					rel="external noopener noreferrer"
					class="inline-flex items-center gap-1 text-xs text-gray-500 no-underline hover:text-primary dark:text-gray-400 dark:hover:text-primary-lighter"
				>
					How games get added
					<IconBoxArrowUpRight size="0.6em" class="opacity-60" />
				</a>
			</div>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				The games players want on the site, most voted first. Requests for expansions or options of an existing game
				live on that game's page.
			</p>

			{#if gameRequests.length === 0}
				<p
					class="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400"
				>
					No game requests yet — be the first!
				</p>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each gameRequests as request (request._id)}
						<li class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<h3 class="font-semibold">{request.label}</h3>
									{#if request.description}
										<p class="mt-1 text-sm whitespace-pre-line text-gray-600 dark:text-gray-400">
											{request.description}
										</p>
									{/if}
								</div>
								<FeedbackLikeButton
									target={{ kind: "game", gameId: request._id }}
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
				<h3 class="font-semibold">Request a game</h3>
				<ForumLinkGate
					bind:this={gameForumGate}
					draftKey="feedback-draft-game-request"
					onrestore={(draft) => {
						gameLabel = draft.label ?? "";
						gameDescription = draft.description ?? "";
					}}
				/>
				{#if gameError}
					<p
						class="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
						role="alert"
					>
						{gameError}
					</p>
				{/if}
				{#if user}
					<form
						class="mt-3"
						onsubmit={(e) => {
							e.preventDefault();
							submitGameRequest();
						}}
					>
						<div class="mb-3">
							<label for="game-request-label" class="mb-1 block text-sm font-medium">Game name</label>
							<Input
								id="game-request-label"
								type="text"
								minlength={2}
								maxlength={80}
								required
								bind:value={gameLabel}
								placeholder="Through the Ages"
							/>
						</div>
						<div class="mb-3">
							<label for="game-request-description" class="mb-1 block text-sm font-medium">
								Description <span class="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
							</label>
							<Input
								type="textarea"
								id="game-request-description"
								maxlength={2000}
								rows={3}
								bind:value={gameDescription}
								placeholder="Why this game would be great on the site…"
							/>
						</div>
						<div class="flex justify-end">
							<Button type="submit" color="primary" disabled={gameSubmitting}>Submit request</Button>
						</div>
					</form>
				{:else}
					<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
						<a href={resolve("/(app)/login")}>Log in</a> or <a href={resolve("/(app)/signup")}>sign up</a> to request a game.
					</p>
				{/if}
			</div>
		</section>

		<section aria-labelledby="site-requests-heading">
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h2 id="site-requests-heading">Site feature requests</h2>
				<a
					href="https://github.com/boardgamers/boardgamers-mono"
					target="_blank"
					rel="external noopener noreferrer"
					class="inline-flex items-center gap-1 text-xs text-gray-500 no-underline hover:text-primary dark:text-gray-400 dark:hover:text-primary-lighter"
				>
					<IconGithub size="0.9em" />
					Site source on GitHub
					<IconBoxArrowUpRight size="0.6em" class="opacity-60" />
				</a>
			</div>
			<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Improvements and new features for the site itself, most voted first.
			</p>

			{#if siteRequests.length === 0}
				<p
					class="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400"
				>
					No feature requests yet — suggest the first one!
				</p>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each siteRequests as request (request._id)}
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
					kind="site"
					{user}
					heading="Suggest a feature"
					titlePlaceholder="Tournament mode"
					bodyPlaceholder="How it would work…"
					submitLabel="Submit suggestion"
					oncreated={(created) => {
						// Same ObjectId → username substitution as the game request (see above).
						created.requestedBy = user?.account.username;
						siteRequests = [...siteRequests, created as FeedbackRequestListing].sort(byLikesThenOldest);
					}}
				/>
			</div>
		</section>
	</div>
</div>
