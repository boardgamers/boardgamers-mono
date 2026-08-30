<!-- Test stub for container-style CDK components (Modal, ModalHeader, ModalFooter,
     InputGroup, …): a `$props()` rest-spread crashes when mounted in the jsdom/svelte
     vitest env (same leaf-component issue as IconStub/BadgeStub). Renders children in
     a plain <div>; extra props are ignored. -->
<script lang="ts">
	let {
		class: className = "",
		children,
	}: {
		class?: string;
		children?: import("svelte").Snippet;
		[key: string]: unknown;
	} = $props();
</script>

<div class={className}>{@render children?.()}</div>
