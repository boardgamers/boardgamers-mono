<script lang="ts">
	// Brand palette straight from app.css @theme tokens; the gradient mixes the two hero
	// colors (primary blue + accent green) used across the home page.
	const colors = {
		primary: "#14508f",
		primaryLight: "#1e6bb8",
		primaryLighter: "#5b9bd5",
		primaryDark: "#0d3a68",
		accent: "#508f16",
		accentLight: "#6bb822",
		accentLighter: "#8fd44a",
	};

	interface Props {
		title: string;
		subtitle?: string;
		/** Game label (e.g. "Gaia Project") — renders a monogram badge derived from it. */
		game?: string;
		/** First sentence of the game's description — shown under the title on boardgame cards. */
		description?: string;
		players?: string;
		pace?: string;
	}

	let { title, subtitle = "", game = "", description = "", players = "", pace = "" }: Props = $props();

	const background = `radial-gradient(ellipse 700px 520px at 96% -12%, ${colors.accent}a6 0%, transparent 58%),
		radial-gradient(ellipse 620px 460px at -6% 112%, ${colors.accentLight}73 0%, transparent 55%),
		linear-gradient(125deg, ${colors.primaryDark} 0%, ${colors.primary} 52%, ${colors.primaryLight} 100%)`;

	// Faint game-board grid overlay, sized so it ends exactly at the 630px card edge.
	const grid =
		"background-image: linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px); background-size: 90px 90px;";

	let monogram = $derived(
		[...game]
			.filter((c) => c >= "A" && c <= "Z")
			.slice(0, 2)
			.join("") ||
			[...game.trim()][0]?.toUpperCase() ||
			"🎲"
	);
	let titleSize = $derived(title.length > 40 ? 56 : title.length > 22 ? 72 : game ? 84 : 92);
</script>

<div style="width: 1200px; height: 630px; position: relative; overflow: hidden; background: {background};">
	<div style="position: absolute; inset: 0; {grid}"></div>
	<!-- Decorative ghost logos, invert-tinted white -->
	<img
		src="/logo.svg"
		width="640"
		height="640"
		alt=""
		style="position: absolute; right: -170px; bottom: -190px; opacity: 0.12; transform: rotate(18deg); filter: invert(1);"
	/>
	<img
		src="/logo.svg"
		width="340"
		height="340"
		alt=""
		style="position: absolute; left: -90px; top: -100px; opacity: 0.09; transform: rotate(-14deg); filter: invert(1);"
	/>
	<div
		style="position: absolute; right: 300px; top: 70px; width: 100px; height: 100px; border-radius: 22px; background: {colors.accentLighter}; opacity: 0.1; transform: rotate(-12deg);"
	></div>

	<div
		style="position: relative; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; padding: 60px 64px 52px; color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;"
	>
		<div style="display: flex; flex-direction: column; gap: 26px; max-width: {game ? '840px' : '100%'};">
			<div
				style="font-size: {titleSize}px; font-weight: 700; line-height: 1.08; overflow-wrap: break-word; text-shadow: 0 2px 10px rgba(9, 42, 77, 0.55);"
			>
				{title}
			</div>
			{#if subtitle}
				<div
					style="font-size: 34px; font-weight: 400; color: #d6e8f8; line-height: 1.32; text-shadow: 0 1px 6px rgba(9, 42, 77, 0.5);"
				>
					{subtitle}
				</div>
			{/if}
			{#if description}
				<div
					style="font-size: 30px; font-weight: 400; color: #d6e8f8; opacity: 0.9; line-height: 1.35; text-shadow: 0 1px 6px rgba(9, 42, 77, 0.5); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"
				>
					{description}
				</div>
			{/if}
			{#if players || pace}
				<div style="display: flex; align-items: center; gap: 16px;">
					{#if players}
						<div
							style="font-size: 26px; font-weight: 600; color: #ffffff; background: {colors.accent}; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; padding: 10px 26px; box-shadow: 0 2px 10px rgba(9, 42, 77, 0.4);"
						>
							{players}
						</div>
					{/if}
					{#if pace}
						<div
							style="font-size: 26px; font-weight: 600; color: #e7f3ff; border: 2px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 9px 24px; text-shadow: 0 1px 4px rgba(9, 42, 77, 0.5);"
						>
							{pace}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if game}
			<!-- Per-game "icon": monogram derived from the game's label (no per-game art exists) -->
			<div
				style="position: absolute; top: 96px; right: 96px; width: 210px; height: 210px; border-radius: 44px; display: flex; align-items: center; justify-content: center; font-size: 100px; font-weight: 800; color: #ffffff; letter-spacing: 4px; padding-right: 4px; box-sizing: border-box; background: linear-gradient(140deg, {colors.accentLight} 0%, {colors.accent} 100%); border: 2px solid rgba(255,255,255,0.28); box-shadow: 0 14px 44px rgba(9, 42, 77, 0.5); transform: rotate(5deg);"
			>
				{monogram}
			</div>
		{/if}

		<div style="display: flex; align-items: center; gap: 20px;">
			<div
				style="width: 64px; height: 64px; border-radius: 16px; background: #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(9, 42, 77, 0.45);"
			>
				<img src="/logo.svg" width="46" height="46" alt="" />
			</div>
			<div
				style="font-size: 32px; font-weight: 600; letter-spacing: 0.5px; text-shadow: 0 1px 6px rgba(9, 42, 77, 0.5);"
			>
				boardgamers.space
			</div>
		</div>
	</div>
</div>
