<!-- Test stub for the CDK Input: a `$props()` rest-spread crashes when mounted in
     the jsdom/svelte vitest env (same leaf-component issue as IconStub/BadgeStub).
     Forwards the props component specs actually need, including bind:value. -->
<script lang="ts">
	let {
		value = $bindable(""),
		type = "text",
		id = undefined,
		placeholder = undefined,
		required = false,
		disabled = false,
		class: className = "",
	}: {
		value?: unknown;
		type?: string;
		id?: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

{#if type === "textarea"}
	<textarea {id} class={className} {placeholder} {required} {disabled} bind:value></textarea>
{:else}
	<input {type} {id} class={className} {placeholder} {required} {disabled} bind:value />
{/if}
