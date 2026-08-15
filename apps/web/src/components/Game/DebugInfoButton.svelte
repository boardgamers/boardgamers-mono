<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import { Button } from "@/modules/cdk";
	import IconBug from "@/components/icons/IconBug.svelte";
	import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST, type GameDebugInfo } from "@/lib/debug-info";
	import { notifier } from "@/lib/notifications.svelte";
	import { developerSettings } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";

	const context: GameContext = getContext("game");
	const { emitter } = context;

	let pending = $state(false);
	let pendingResolve: ((info: GameDebugInfo) => void) | undefined;

	function onDebugInfo(info: GameDebugInfo) {
		pendingResolve?.(info);
		pendingResolve = undefined;
		pending = false;
	}

	emitter.on(DEBUG_INFO_MESSAGE, onDebugInfo);
	onDestroy(() => {
		emitter.off(DEBUG_INFO_MESSAGE, onDebugInfo);
	});

	// The parent (StartedGame) owns the full context + the viewer's player index and
	// preferences, so ask it to assemble the snapshot instead of duplicating that logic.
	function requestDebugInfo(): Promise<GameDebugInfo> {
		return new Promise((resolve, reject) => {
			pendingResolve = resolve;
			emitter.emit(DEBUG_INFO_REQUEST);
			setTimeout(() => {
				if (pendingResolve) {
					pendingResolve = undefined;
					pending = false;
					reject(new Error("Timed out gathering debug info"));
				}
			}, 5000);
		});
	}

	async function copyDebugInfo() {
		if (pending) {
			return;
		}
		pending = true;
		try {
			const info = await requestDebugInfo();
			await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
			notifier.success("Debug info copied to clipboard");
		} catch (err) {
			handleError(err);
		} finally {
			pending = false;
		}
	}
</script>

<!-- The snapshot embeds the full game state, which leaks hidden information in
     hidden-information games — only offer it with developer settings enabled. -->
{#if $developerSettings}
	<Button
		color="secondary"
		onclick={copyDebugInfo}
		disabled={pending}
		class="!rounded-full sidebar-fab debug-button"
		title="Copy debug info"
		aria-label="Copy debug info"
	>
		<IconBug size="1.5rem" />
	</Button>
{/if}
