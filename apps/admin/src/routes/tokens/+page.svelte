<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import type { AdminTokenFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let name = $state("");
	let ttlDays = $state(30);
	let creating = $state(false);
	// Raw token from the last creation — the api returns it exactly once.
	let createdToken = $state<{ name: string; token: string } | null>(null);
	let revoking = $state<string | null>(null);

	function statusOf(t: AdminTokenFront): "revoked" | "expired" | "active" {
		if (t.revokedAt) return "revoked";
		if (new Date(t.expiresAt).getTime() <= Date.now()) return "expired";
		return "active";
	}

	async function createToken() {
		creating = true;
		try {
			const res = await api.post<{ name: string; token: string }>("/admin/tokens", {
				name: name.trim(),
				ttlDays,
			});
			createdToken = { name: res.name, token: res.token };
			name = "";
			toast.success(`Token "${res.name}" created`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create token");
		} finally {
			creating = false;
		}
	}

	async function copyToken() {
		if (!createdToken) return;
		try {
			await navigator.clipboard.writeText(createdToken.token);
			toast.success("Token copied to clipboard");
		} catch {
			toast.error("Copy failed — select the token text manually");
		}
	}

	async function revoke(t: AdminTokenFront) {
		revoking = t._id;
		try {
			await api.del(`/admin/tokens/${t._id}`);
			toast.success(`Token "${t.name}" revoked`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to revoke token");
		} finally {
			revoking = null;
		}
	}
</script>

<svelte:head>
	<title>Admin Tokens — Admin</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<div>
		<h2 class="text-xl font-bold">Admin tokens</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Personal credentials for scripting <code class="text-xs">/api/admin/*</code> without a password — e.g. handing a token
			to an agent. They authenticate as you on admin routes only, expire automatically (max 90 days), and stop working if
			your account loses admin rights. Only the token's hash is stored; the raw value is shown once at creation.
		</p>
	</div>

	<!-- Create -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
		<h3 class="text-sm font-semibold mb-4">Create a token</h3>
		<form
			class="flex items-end gap-3 flex-wrap"
			onsubmit={(e) => {
				e.preventDefault();
				createToken();
			}}
		>
			<label class="flex-1 min-w-48">
				<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</span>
				<input
					bind:value={name}
					required
					maxlength="100"
					placeholder="e.g. local agent, CI script"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</label>
			<label class="w-32">
				<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Expires in (days)</span>
				<input
					bind:value={ttlDays}
					type="number"
					min="1"
					max="90"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</label>
			<button
				type="submit"
				disabled={creating || !name.trim()}
				class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
			>
				{creating ? "Creating…" : "Create"}
			</button>
		</form>

		{#if createdToken}
			<div class="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
				<p class="text-sm font-medium text-amber-800 dark:text-amber-200">
					Token "{createdToken.name}" created — shown only once, copy it now.
				</p>
				<div class="mt-2 flex items-center gap-2">
					<code
						class="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 text-xs font-mono break-all select-all"
						>{createdToken.token}</code
					>
					<button
						onclick={copyToken}
						class="px-3 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex-shrink-0"
					>
						Copy
					</button>
				</div>
				<button
					onclick={() => (createdToken = null)}
					class="mt-2 text-xs text-amber-700 dark:text-amber-300 hover:underline">Dismiss</button
				>
			</div>
		{/if}
	</div>

	<!-- List -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
			<h3 class="text-sm font-semibold">
				Your tokens
				<span class="text-gray-400 font-normal">({data.tokens.length})</span>
			</h3>
		</div>
		{#if data.tokens.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
							<th class="py-2 pl-5 pr-4">Name</th>
							<th class="py-2 pr-4">Created</th>
							<th class="py-2 pr-4">Expires</th>
							<th class="py-2 pr-4">Last used</th>
							<th class="py-2 pr-4">Status</th>
							<th class="py-2 pr-5"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.tokens as t (t._id)}
							{@const status = statusOf(t)}
							<tr class="border-b border-gray-50 dark:border-gray-800/50">
								<td class="py-2.5 pl-5 pr-4 font-medium">{t.name}</td>
								<td class="py-2.5 pr-4 text-gray-500">{timeAgo(t.createdAt)}</td>
								<td class="py-2.5 pr-4 text-gray-500">
									{new Date(t.expiresAt).toLocaleDateString()}
								</td>
								<td class="py-2.5 pr-4 text-gray-500">{t.lastUsedAt ? timeAgo(t.lastUsedAt) : "never"}</td>
								<td class="py-2.5 pr-4">
									<span
										class="px-2 py-0.5 text-xs font-medium rounded-full {status === 'active'
											? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
											: status === 'revoked'
												? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
												: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}"
									>
										{status}
									</span>
								</td>
								<td class="py-2.5 pr-5 text-right">
									{#if status === "active"}
										<button
											onclick={() => revoke(t)}
											disabled={revoking === t._id}
											class="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
										>
											{revoking === t._id ? "…" : "Revoke"}
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="px-5 py-4 text-sm text-gray-500">No tokens yet. Create one above to script admin APIs.</p>
		{/if}
	</div>
</div>
