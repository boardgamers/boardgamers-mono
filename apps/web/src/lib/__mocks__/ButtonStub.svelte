<!-- Test stub for the CDK Button: a `$props()` rest-spread crashes when mounted in
     the jsdom/svelte vitest env (same leaf-component issue as IconStub/BadgeStub), so
     this stub only forwards the props component specs actually need. Renders a real
     <button> so specs can click / check disabled. -->
<script lang="ts">
	let {
		class: className = "",
		disabled = false,
		type = "button",
		onclick,
		children,
	}: {
		class?: string;
		disabled?: boolean;
		type?: "button" | "submit" | "reset";
		onclick?: (event: MouseEvent) => void;
		children?: import("svelte").Snippet;
	} = $props();
</script>

<button {type} class={className} {disabled} {onclick}>{@render children?.()}</button>
