<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { get } from "@/lib/api";
	import { setAuthData, type AuthData } from "@/lib/account.svelte";

	let error = $state<string | null>(null);

	// The exchange runs in onMount, not in a load function: setAuthData() calls
	// invalidateAll(), which would re-run a load-based exchange with the already-used
	// (single-use) OAuth code and fail with 'Invalid "code" in request'.
	onMount(async () => {
		try {
			const response = await get<{ createSocialAccount: boolean } & AuthData>(
				`/account/auth/${page.params.provider}/callback`,
				page.url.searchParams
			);

			if (response.createSocialAccount) {
				// oxlint-disable-next-line typescript/no-explicit-any
				await goto("/signup?" + new URLSearchParams(response as any).toString(), { replaceState: true });
				return;
			}

			await setAuthData(response);
			await goto("/account", { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	});
</script>

<div class="container mx-auto px-4 py-8">
	{#if error}
		<h1>Login failed</h1>
		<p class="text-red-600">{error}</p>
		<a href="/login">Back to login</a>
	{:else}
		<p>Signing you in…</p>
	{/if}
</div>
