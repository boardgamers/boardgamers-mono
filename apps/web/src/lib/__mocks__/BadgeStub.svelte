<!-- Test stub for Badge: the real one spreads `...rest` onto its root element, which
     crashes in the jsdom/svelte vitest env (same leaf `$props()` rest-spread issue as
     IconStub). Renders a plain span so component specs can exercise their parent. -->
<script lang="ts">
	let { class: className = "", children }: { class?: string; children?: import("svelte").Snippet } = $props();
</script>

<span class={className}>{@render children?.()}</span>
