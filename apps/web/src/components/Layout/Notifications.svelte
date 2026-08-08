<script lang="ts">
	import { toasts, confirmRequest, dismiss, answerConfirm, type ToastKind } from "@/lib/notifications.svelte";
	import IconCart from "@/components/icons/IconCart.svelte";
	import { fly, fade } from "svelte/transition";

	const kindStyles: Record<ToastKind, { bar: string; icon: string; label: string }> = {
		alert: { bar: "bg-red-600", icon: "⚠", label: "Error" },
		info: { bar: "bg-primary", icon: "ℹ", label: "Info" },
		success: { bar: "bg-green-600", icon: "✓", label: "Success" },
	};
</script>

<!-- Toasts (bottom-right) -->
<div class="pointer-events-none fixed right-4 bottom-4 z-[1100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
	{#each $toasts as toast (toast.id)}
		{@const style = kindStyles[toast.kind]}
		<div
			class="pointer-events-auto flex items-start gap-2 overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10"
			role="alert"
			transition:fly={{ y: 24, duration: 200 }}
		>
			<div class="w-1.5 self-stretch {style.bar}"></div>
			<div class="flex-1 py-2.5 pr-3 pl-1 text-sm">
				<div class="font-semibold">{style.icon} {style.label}</div>
				<div class="wrap-break-word whitespace-pre-wrap text-gray-700 dark:text-gray-200">{toast.text}</div>
			</div>
			<button
				type="button"
				class="mt-1 mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
				aria-label="Dismiss"
				onclick={() => dismiss(toast.id)}
			>
				&times;
			</button>
		</div>
	{/each}
</div>

<!-- Confirm dialog -->
{#if $confirmRequest}
	<div
		class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 150 }}
		onclick={(e) => e.target === e.currentTarget && answerConfirm(false)}
		onkeydown={(e) => e.key === "Escape" && answerConfirm(false)}
	>
		<div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-800" role="document">
			<h3 class="mb-2 font-semibold">Confirmation required</h3>
			<p class="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-200">{$confirmRequest.text}</p>
			{#if $confirmRequest.link}
				<a
					href={$confirmRequest.link.url}
					target="_blank"
					rel="external noopener noreferrer"
					class="mt-2 inline-flex items-center gap-1.5 text-sm"
				>
					<IconCart />
					{$confirmRequest.link.label}
				</a>
			{/if}
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
					onclick={() => answerConfirm(false)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-light"
					onclick={() => answerConfirm(true)}
				>
					OK
				</button>
			</div>
		</div>
	</div>
{/if}
