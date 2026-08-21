<script lang="ts">
	import { resolve } from "$app/paths";
	import ForumLinkGate, { type ForumLinkGate as ForumLinkGateHandle } from "@/components/ForumLinkGate.svelte";
	import { post } from "@/lib/api";
	import { Button, Input } from "@/modules/cdk";
	import type { FeedbackKind, UserFront } from "@bgs/models";
	import { m } from "@/lib/i18n/messages";

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
	let forumGate: ForumLinkGateHandle | undefined = $state();

	async function submit() {
		error = "";
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
			if (forumGate?.handle(err)) {
				forumGate?.stashDraft({ title, body });
			} else {
				error = err instanceof Error ? err.message : m.feedback_submitError();
			}
		} finally {
			submitting = false;
		}
	}
</script>

<h3 class="font-semibold">{heading}</h3>
<ForumLinkGate
	bind:this={forumGate}
	{draftKey}
	onrestore={(draft) => {
		title = draft.title ?? "";
		body = draft.body ?? "";
	}}
/>
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
			<label for="{inputId}-title" class="mb-1 block text-sm font-medium">{m.feedback_title()}</label>
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
				{m.feedback_details()} <span class="font-normal text-gray-500 dark:text-gray-400">{m.common_optional()}</span>
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
		<a href={resolve("/(app)/login")}>{m.common_logIn()}</a>
		{m.feedback_or()}
		<a href={resolve("/(app)/signup")}>{m.common_signUp()}</a>
		{m.feedback_loginToSubmit()}
	</p>
{/if}
