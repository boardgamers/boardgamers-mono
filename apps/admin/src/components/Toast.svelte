<script lang="ts">
	import { toasts } from "$lib/toast.svelte.ts";
</script>

{#if toasts.length > 0}
	<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
		{#each toasts as t (t.id)}
			<div
				class="rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-in
          {t.type === 'success' ? 'bg-emerald-600 text-white' : ''}
          {t.type === 'error' ? 'bg-red-600 text-white' : ''}
          {t.type === 'info' ? 'bg-blue-600 text-white' : ''}"
				role="alert"
			>
				{t.message}
			</div>
		{/each}
	</div>
{/if}

<style>
	.animate-in {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(1rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
