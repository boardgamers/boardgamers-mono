<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { Button } from "@/modules/cdk";
	import { get, post } from "@/lib/api";

	type UnsubscribeInfo = { scope: "game" | "newsletter"; username: string };

	const token = page.url.searchParams.get("token") ?? "";

	const scopeLabels: Record<UnsubscribeInfo["scope"], string> = {
		game: "game notification emails (your turn, game cancelled)",
		newsletter: "the newsletter",
	};

	let info = $state<UnsubscribeInfo | null>(null);
	let invalid = $state(false);
	let done = $state(false);
	let busy = $state(false);

	if (token) {
		get<UnsubscribeInfo>(`/account/unsubscribe/${encodeURIComponent(token)}`).then(
			(data) => (info = data),
			() => (invalid = true)
		);
	} else {
		invalid = true;
	}

	function unsubscribe() {
		busy = true;
		post<UnsubscribeInfo>("/account/unsubscribe", { token }).then(
			() => (done = true),
			() => (invalid = true)
		);
	}
</script>

<div class="container mx-auto max-w-xl px-4">
	<h1>Unsubscribe</h1>
	{#if done && info}
		<p>Done — <b>{info.username}</b> is unsubscribed from {scopeLabels[info.scope]}.</p>
		<p>You can re-enable them any time from your <a href={resolve("/(app)/account")}>account page</a>.</p>
	{:else if invalid}
		<p>This unsubscribe link is invalid or has expired.</p>
		<p>
			You can manage your email notifications from your <a href={resolve("/(app)/account")}>account page</a>.
		</p>
	{:else if info}
		<p>
			Hi <b>{info.username}</b> — click the button below to stop receiving {scopeLabels[info.scope]}.
		</p>
		<Button color="primary" disabled={busy} onclick={unsubscribe}>Unsubscribe</Button>
	{:else}
		<p>Checking your unsubscribe link…</p>
	{/if}
</div>
