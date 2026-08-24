<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { Button } from "@/modules/cdk";
	import { get, post } from "@/lib/api";
	import { m } from "@/lib/i18n/messages";

	type UnsubscribeInfo = { scope: "game" | "newsletter"; username: string };

	const token = page.url.searchParams.get("token") ?? "";

	// Scope copy resolves per render so a language switch re-labels in place.
	let scopeLabels = $derived<Record<UnsubscribeInfo["scope"], string>>({
		game: m.unsubscribe_scope_game(),
		newsletter: m.unsubscribe_scope_newsletter(),
	});

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
	<h1>{m.unsubscribe_title()}</h1>
	{#if done && info}
		<p>{m.unsubscribe_done({ username: info.username, scope: scopeLabels[info.scope] })}</p>
		<p>
			{m.unsubscribe_reenable()} <a href={resolve("/(app)/account")}>{m.unsubscribe_accountPage()}</a>.
		</p>
	{:else if invalid}
		<p>{m.unsubscribe_invalid()}</p>
		<p>
			{m.unsubscribe_manage()} <a href={resolve("/(app)/account")}>{m.unsubscribe_accountPage()}</a>.
		</p>
	{:else if info}
		<p>
			{m.unsubscribe_prompt({ username: info.username, scope: scopeLabels[info.scope] })}
		</p>
		<Button color="primary" disabled={busy} onclick={unsubscribe}>{m.unsubscribe_button()}</Button>
	{:else}
		<p>{m.unsubscribe_checking()}</p>
	{/if}
</div>
