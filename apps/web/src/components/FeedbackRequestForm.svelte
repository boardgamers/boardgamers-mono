<script lang="ts">
	import { resolve } from "$app/paths";
	import { onMount } from "svelte";
	import { ApiError, post } from "@/lib/api";
	import { Button, Input } from "@/modules/cdk";
	import type { FeedbackKind, UserFront } from "@bgs/models";

	// Site + game-specific feedback is posted on the forum AS the user (#340), so it
	// needs a linked forum account. When the API reports forum_account_required, prompt
	// to link it (BGS OAuth on the forum) instead of showing a bare error.
	//
	// The forum's SSO initiate URL (nodebb-plugin-sso-oauth2-multiple strategy
	// "boardgamers") starts BGS OAuth; the forum account is auto-created+linked on first
	// login. The plugin doesn't forward a return URL into the OAuth state, so the draft
	// is stashed in sessionStorage and restored on return instead.
	const FORUM_AUTH_URL = "https://forum.boardgamers.space/auth/boardgamers";

	let props: {
		kind: FeedbackKind;
		// The boardgame id — required when kind is "game".
		game?: string;
		user: UserFront | null;
		heading: string;
		titlePlaceholder: string;
		bodyPlaceholder: string;
		submitLabel: string;
		// The API create response carries the requester's ObjectId — the parent
		// substitutes the current user's name before listing it.
		oncreated: (created: Record<string, unknown>) => void;
	} = $props();

	// Stable for the component's lifetime (a form never changes kind/game), so they
	// are read once up front — only `user` (login state) stays reactive.
	// svelte-ignore state_referenced_locally
	const { kind, game, heading, titlePlaceholder, bodyPlaceholder, submitLabel, oncreated } = props;
	let user = $derived(props.user);

	// Per page (and per game): the draft survives the OAuth round-trip and must not
	// leak across forms — /feedback's site form and each boardgame page get their own.
	const draftKey = `feedback-draft-${kind}${game ? `-${game}` : ""}`;
	const inputId = `feedback-request-${kind}${game ? `-${game}` : ""}`;

	let title = $state("");
	let body = $state("");
	let submitting = $state(false);
	let error = $state("");
	let forumLinkNeeded = $state(false);

	function linkForumAccount() {
		sessionStorage.setItem(draftKey, JSON.stringify({ title, body }));
		window.location.href = FORUM_AUTH_URL;
	}

	onMount(() => {
		// Returning from the forum linking flow: restore the draft so the user can
		// re-submit (their forum account now exists, so the create succeeds).
		const draft = sessionStorage.getItem(draftKey);
		if (draft) {
			sessionStorage.removeItem(draftKey);
			try {
				const parsed = JSON.parse(draft) as { title?: string; body?: string };
				title = parsed.title ?? "";
				body = parsed.body ?? "";
			} catch {
				// Corrupt draft — ignore.
			}
		}
	});

	async function submit() {
		error = "";
		forumLinkNeeded = false;
		submitting = true;
		try {
			const created = await post<Record<string, unknown>>("/feedback", {
				kind,
				...(kind === "game" ? { game } : {}),
				title: title.trim(),
				...(body.trim() ? { body: body.trim() } : {}),
			});
			oncreated(created);
			title = body = "";
		} catch (err) {
			if (err instanceof ApiError && err.code === "forum_account_required") {
				forumLinkNeeded = true;
			} else {
				error = err instanceof Error ? err.message : "Could not submit the request";
			}
		} finally {
			submitting = false;
		}
	}
</script>

<h3 class="font-semibold">{heading}</h3>
{#if forumLinkNeeded}
	<div
		class="mt-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
		role="alert"
	>
		<p>
			Requests are discussed on our forum, so they need a linked forum account. Link yours (it uses your Boardgamers
			login) to submit — your draft is saved.
		</p>
		<Button color="primary" class="mt-2" onclick={linkForumAccount}>Link your forum account</Button>
	</div>
{/if}
{#if error}
	<p
		class="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
		role="alert"
	>
		{error}
	</p>
{/if}
{#if user}
	<form
		class="mt-3"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<div class="mb-3">
			<label for="{inputId}-title" class="mb-1 block text-sm font-medium">Title</label>
			<Input
				id="{inputId}-title"
				type="text"
				minlength={3}
				maxlength={200}
				required
				bind:value={title}
				placeholder={titlePlaceholder}
			/>
		</div>
		<div class="mb-3">
			<label for="{inputId}-body" class="mb-1 block text-sm font-medium">
				Details <span class="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
			</label>
			<Input
				type="textarea"
				id="{inputId}-body"
				maxlength={5000}
				rows={3}
				bind:value={body}
				placeholder={bodyPlaceholder}
			/>
		</div>
		<div class="flex justify-end">
			<Button type="submit" color="primary" disabled={submitting}>{submitLabel}</Button>
		</div>
	</form>
{:else}
	<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
		<a href={resolve("/(app)/login")}>Log in</a> or <a href={resolve("/(app)/signup")}>sign up</a> to submit a request.
	</p>
{/if}
