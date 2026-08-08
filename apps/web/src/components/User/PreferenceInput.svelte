<script lang="ts">
	import SanitizedHtml from "../SanitizedHtml.svelte";
	import { FormGroup, Input, Label } from "@/modules/cdk";
	import Checkbox from "@/modules/cdk/Checkbox.svelte";
	import type { GameInfoOption } from "@bgs/models";
	import { oneLineMarked } from "@/utils";

	let {
		item,
		value = $bindable(),
		onchange,
	}: {
		item: GameInfoOption;
		value?: any;
		onchange?: (val: string | boolean) => void;
	} = $props();

	function handleChange(val: string | boolean) {
		value = val;
		onchange?.(val);
	}
</script>

{#if item.type === "checkbox"}
	<Checkbox checked={value} onchange={(event) => handleChange((event.target as HTMLInputElement).checked)}>
		{item.label}
	</Checkbox>
{:else if item.type === "select"}
	<FormGroup class="mt-2">
		<Label class="mb-1 block text-sm"><SanitizedHtml html={oneLineMarked(item.label)} /></Label>
		<Input
			type="select"
			{value}
			onchange={(event) => handleChange((event.target as HTMLSelectElement).value)}
			bsSize="sm"
		>
			{#each item.items as option (option.name)}
				<option value={option.name}>{option.label}</option>
			{/each}
		</Input>
	</FormGroup>
{/if}
