<!-- Test stub for the CDK Button: a `$props()` rest-spread crashes when mounted in
     the jsdom/svelte vitest env (same leaf-component issue as IconStub/BadgeStub), so
     this stub only forwards the props component specs actually need. -->
<script lang="ts">
	let {
		class: className = "",
		disabled = false,
		onclick,
		children,
	}: {
		class?: string;
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<button type="button" class={className} {disabled} {onclick}>{@render children?.()}</button>
