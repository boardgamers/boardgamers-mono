<!-- Test stub for cdk Button: the real one spreads `...rest` onto its root element,
     which crashes in the jsdom/svelte vitest env (same leaf `$props()` rest-spread
     issue as IconStub). Renders a real <button> so specs can click / check disabled. -->
<script lang="ts">
	let {
		disabled = false,
		type = "button",
		class: className = "",
		children,
		onclick,
	}: {
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		class?: string;
		children?: import("svelte").Snippet;
		onclick?: (e: MouseEvent) => void;
	} = $props();
</script>

<button {type} {disabled} class={className} {onclick}>{@render children?.()}</button>
