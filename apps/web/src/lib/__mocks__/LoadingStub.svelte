<!-- Test stub for the CDK Loading component (its Spinner crashes when mounted in the
     jsdom/svelte vitest env, same class of issue as IconStub/BadgeStub). A plain marker
     keeps the loading state assertable without pulling in the cdk internals. -->
<script lang="ts">
	let { loading = false }: { loading?: boolean } = $props();
</script>

{#if loading}
	<span class="loading-stub" data-loading-stub>Loading…</span>
{/if}
