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
		/** Game emoji (e.g. "🌏") — shown as the badge instead of the monogram when present. */
		emoji?: string;
		/** First sentence of the game's description — shown under the title on boardgame cards. */
		description?: string;
		players?: string;
		pace?: string;
		/** Username on user cards — fallback monogram if no avatar image. */
		username?: string;
		/** Karma chip on user cards. */
		karma?: string;
		/** User card: inlined avatar image (data URL); falls back to the username monogram. */
		avatar?: string;
		/** User card: "🇫🇷 France" chip. */
		country?: string;
		/** User card: top boardgame by games played, with elo. */
		topGame?: string;
		/** Call-to-action line/chip (e.g. "Play boardgames online" / "Challenge me"). */
		cta?: string;
		/** Game card: crucial setup options (map, expansions, …) as chip strings. */
		gameOptions?: string[];
	}

	let {
		title,
		subtitle = "",
		game = "",
		emoji = "",
		description = "",
		players = "",
		pace = "",
		username = "",
		karma = "",
		avatar = "",
		country = "",
		topGame = "",
		cta = "",
		gameOptions = [],
	}: Props = $props();

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
	let userMonogram = $derived([...username.trim()][0]?.toUpperCase() || "?");
	let titleSize = $derived(title.length > 40 ? 56 : title.length > 22 ? 72 : game ? 84 : 92);
</script>

<div style="width: 1200px; height: 630px; position: relative; overflow: hidden; background: {background};">
	<div style="position: absolute; inset: 0; {grid}"></div>
	<!-- Decorative ghost impressions: dice, invert-tinted white (the dice.svg strokes are
	green, so invert(1) makes them read as faint pink-white; low opacity keeps it a watermark) -->
	<img
		src="/images/icons/dice.svg"
		width="640"
		height="640"
		alt=""
		style="position: absolute; right: -170px; bottom: -190px; opacity: 0.12; transform: rotate(18deg); filter: invert(1);"
	/>
	<img
		src="/images/icons/dice.svg"
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
		<div style="display: flex; flex-direction: column; gap: 26px; max-width: {game || username ? '840px' : '100%'};">
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
			{#if players || pace || karma || country || topGame || cta || gameOptions.length > 0}
				<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 16px; max-width: 880px;">
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
					{#if karma}
						<div
							style="font-size: 26px; font-weight: 600; color: #e7f3ff; border: 2px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 9px 24px; text-shadow: 0 1px 4px rgba(9, 42, 77, 0.5);"
						>
							{karma}
						</div>
					{/if}
					{#if country}
						<div
							style="font-size: 26px; font-weight: 600; color: #e7f3ff; border: 2px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 9px 24px; text-shadow: 0 1px 4px rgba(9, 42, 77, 0.5);"
						>
							{country}
						</div>
					{/if}
					{#if topGame}
						<div
							style="font-size: 26px; font-weight: 600; color: #e7f3ff; border: 2px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 9px 24px; text-shadow: 0 1px 4px rgba(9, 42, 77, 0.5);"
						>
							{topGame}
						</div>
					{/if}
					{#if cta}
						<div
							style="font-size: 26px; font-weight: 600; color: #ffffff; background: {colors.accent}; border: 1px solid rgba(255,255,255,0.35); border-radius: 999px; padding: 10px 26px; box-shadow: 0 2px 10px rgba(9, 42, 77, 0.4);"
						>
							{cta}
						</div>
					{/if}
					{#each gameOptions as option (option)}
						<div
							style="font-size: 24px; font-weight: 600; color: #e7f3ff; border: 2px solid rgba(255,255,255,0.4); border-radius: 999px; padding: 7px 20px; text-shadow: 0 1px 4px rgba(9, 42, 77, 0.5);"
						>
							{option}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if game}
			<!-- Per-game "icon": the game's emoji, else a monogram derived from its label (no per-game art exists) -->
			<div
				style="position: absolute; top: 96px; right: 96px; width: 210px; height: 210px; border-radius: 44px; display: flex; align-items: center; justify-content: center; font-size: {emoji
					? 120
					: 100}px; font-weight: 800; color: #ffffff; {emoji
					? ''
					: 'letter-spacing: 4px; padding-right: 4px;'} box-sizing: border-box; background: linear-gradient(140deg, {colors.accentLight} 0%, {colors.accent} 100%); border: 2px solid rgba(255,255,255,0.28); box-shadow: 0 14px 44px rgba(9, 42, 77, 0.5); transform: rotate(5deg);"
			>
				{emoji || monogram}
			</div>
		{:else if username}
			<!-- Real avatar (inlined data URL) when available; otherwise the username monogram. -->
			{#if avatar}
				<img
					src={avatar}
					width="210"
					height="210"
					alt=""
					style="position: absolute; top: 96px; right: 96px; width: 210px; height: 210px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.28); box-shadow: 0 14px 44px rgba(9, 42, 77, 0.5);"
				/>
			{:else}
				<div
					style="position: absolute; top: 96px; right: 96px; width: 210px; height: 210px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 100px; font-weight: 800; color: #ffffff; box-sizing: border-box; background: linear-gradient(140deg, {colors.primaryLighter} 0%, {colors.primary} 100%); border: 2px solid rgba(255,255,255,0.28); box-shadow: 0 14px 44px rgba(9, 42, 77, 0.5);"
				>
					{userMonogram}
				</div>
			{/if}
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
