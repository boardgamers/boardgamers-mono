<script lang="ts">
	let { title, subtitle }: { title: string; subtitle?: string } = $props();
</script>

<div
	style:width="1200px"
	style:height="630px"
	style:display="flex"
	style:flex-direction="column"
	style:justify-content="space-between"
	style:padding="64px"
	style:box-sizing="border-box"
	style:background="linear-gradient(135deg, #0d3a68 0%, #14508f 55%, #1e6bb8 100%)"
	style:color="#ffffff"
	style:font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
>
	<div style:display="flex" style:flex-direction="column" style:gap="24px">
		<div
			style:font-size={title.length > 40 ? "64px" : "84px"}
			style:font-weight="700"
			style:line-height="1.1"
			style:overflow-wrap="break-word"
		>
			{title}
		</div>
		{#if subtitle}
			<div style:font-size="36px" style:font-weight="400" style:color="#cfe3f5" style:line-height="1.3">
				{subtitle}
			</div>
		{/if}
	</div>
	<div style:display="flex" style:align-items="center" style:gap="20px">
		<img src="/images/icons/dice.svg" width="56" height="56" alt="" style:filter="invert(1)" />
		<div style:font-size="32px" style:font-weight="600" style:letter-spacing="0.5px">boardgamers.space</div>
	</div>
</div>
