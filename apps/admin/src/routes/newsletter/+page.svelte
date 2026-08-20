<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { onDestroy, onMount } from "svelte";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import MarkdownEditor from "$components/MarkdownEditor.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let subject = $state("");
	let markdown = $state("");
	let sendingTest = $state(false);
	let queueing = $state(false);
	let confirming = $state(false);
	// Re-fetched when the dialog opens so the admin confirms the live number.
	let confirmCount = $state(0);

	const ready = $derived(!!subject.trim() && !!markdown.trim());
	const active = $derived(data.newsletters.find((n) => n.status !== "done"));

	async function sendTest() {
		sendingTest = true;
		try {
			const res = await api.post<{ to: string }>("/admin/newsletter/test", {
				subject: subject.trim(),
				markdown: markdown.trim(),
			});
			toast.success(`Test sent to ${res.to}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to send the test");
		} finally {
			sendingTest = false;
		}
	}

	async function openConfirm() {
		confirming = true;
		confirmCount = data.recipientCount;
		confirmCount = await api
			.get<{ count: number }>("/admin/newsletter/count")
			.then((r) => r.count)
			.catch(() => data.recipientCount);
	}

	async function queueSend() {
		queueing = true;
		try {
			await api.post("/admin/newsletter/send", { subject: subject.trim(), markdown: markdown.trim() });
			toast.success("Newsletter queued — the cron delivers it in batches");
			confirming = false;
			subject = "";
			markdown = "";
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to queue the newsletter");
		} finally {
			queueing = false;
		}
	}

	// Live progress while a blast is queued/sending.
	let poller: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		poller = setInterval(() => {
			if (data.newsletters.some((n) => n.status !== "done")) {
				invalidateAll();
			}
		}, 5000);
	});
	onDestroy(() => clearInterval(poller));
</script>

<svelte:head>
	<title>Newsletter — Admin</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<div>
		<h2 class="text-xl font-bold">Newsletter</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Compose a newsletter for the <strong>{data.recipientCount}</strong> subscribed user{data.recipientCount === 1
				? ""
				: "s"} (opted in, confirmed accounts only). Sending <strong>queues</strong> the blast — the cron delivers it in small
			batches (a few per minute), never all at once. Every email carries a one-click unsubscribe.
		</p>
	</div>

	{#if active}
		<div
			class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-5 py-4 text-sm"
		>
			<span class="font-semibold">"{active.subject}"</span>
			{#if active.status === "pending"}
				is queued — delivery starts on the next cron tick.
			{:else}
				is sending: <strong>{active.sentCount}/{active.recipientCount}</strong> delivered{active.errorCount > 0
					? `, ${active.errorCount} failed`
					: ""}.
			{/if}
			Wait for it to finish before queueing another one.
		</div>
	{/if}

	<!-- Composer -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
		<h3 class="text-sm font-semibold">Compose</h3>
		<label class="block">
			<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Subject</span>
			<input
				bind:value={subject}
				maxlength="200"
				placeholder="e.g. New game on Boardgamers: …"
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			/>
		</label>
		<MarkdownEditor bind:value={markdown} label="Body (Markdown)" rows={12} />
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<span class="text-xs text-gray-500 dark:text-gray-400">
				Always send a test first — it's exactly what subscribers receive, from the newsletter address.
			</span>
			<div class="flex gap-2">
				<button
					onclick={sendTest}
					disabled={!ready || sendingTest}
					class="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
				>
					{sendingTest ? "Sending…" : "Send test to me"}
				</button>
				<button
					onclick={openConfirm}
					disabled={!ready || !!active}
					title={active ? "A newsletter is already queued or sending" : ""}
					class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
				>
					Send to all subscribers
				</button>
			</div>
		</div>
	</div>

	<!-- Queue / history -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
			<h3 class="text-sm font-semibold">
				Queue & history
				<span class="text-gray-400 font-normal">({data.newsletters.length})</span>
			</h3>
		</div>
		{#if data.newsletters.length > 0}
			<ul class="divide-y divide-gray-100 dark:divide-gray-800/60">
				{#each data.newsletters as n (n._id)}
					<li class="px-5 py-3 flex items-center justify-between gap-3">
						<div class="min-w-0">
							<span class="font-medium text-sm truncate">{n.subject}</span>
							<div class="text-xs text-gray-400 mt-0.5" title={n.createdAt}>
								{timeAgo(n.createdAt)} · {n.recipientCount} recipient{n.recipientCount === 1 ? "" : "s"}
							</div>
						</div>
						<div class="flex items-center gap-2 flex-shrink-0">
							{#if n.errorCount > 0}
								<span
									class="px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-300"
								>
									{n.errorCount} failed
								</span>
							{/if}
							{#if n.status === "pending"}
								<span
									class="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300"
								>
									queued
								</span>
							{:else if n.status === "sending"}
								<span
									class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
								>
									sending {n.sentCount}/{n.recipientCount}
								</span>
							{:else}
								<span
									class="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300"
								>
									sent {n.sentCount}/{n.recipientCount}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="px-5 py-4 text-sm text-gray-500">No newsletter sent yet.</p>
		{/if}
	</div>
</div>

<!-- Confirmation dialog -->
{#if confirming}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div
			class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 max-w-md w-full space-y-4"
		>
			<h3 class="text-lg font-bold">Queue this newsletter?</h3>
			<p class="text-sm text-gray-600 dark:text-gray-300">
				<strong>"{subject.trim()}"</strong> will be delivered to
				<strong>{confirmCount}</strong> subscribed user{confirmCount === 1 ? "" : "s"}.
			</p>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				Confirming <strong>queues</strong> the blast — the cron then delivers it in small batches (a few per minute), not
				instantly. You can watch progress in the queue below. This cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button
					onclick={() => (confirming = false)}
					class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					onclick={queueSend}
					disabled={queueing}
					class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
				>
					{queueing ? "Queueing…" : `Queue for ${confirmCount} subscribers`}
				</button>
			</div>
		</div>
	</div>
{/if}
