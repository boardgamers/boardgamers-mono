<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import { Button } from "@/modules/cdk";
	import IconBug from "@/components/icons/IconBug.svelte";
	import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST } from "@/lib/debug-info";
	import { notifier } from "@/lib/notifications.svelte";
	import { developerSettings } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";

	const context: GameContext = getContext("game");
	const { emitter } = context;

	let pending = $state(false);
	let pendingResolve: ((data: unknown) => void) | undefined;

	function onDebugInfo(data: unknown) {
		pendingResolve?.(data);
		pendingResolve = undefined;
		pending = false;
	}

	emitter.on(DEBUG_INFO_MESSAGE, onDebugInfo);
	onDestroy(() => {
		emitter.off(DEBUG_INFO_MESSAGE, onDebugInfo);
	});

	// The game's viewer owns the debug payload: StartedGame relays the request to the
	// iframe, and the viewer (if it implements the protocol) answers with `debugInfo`.
	function requestDebugInfo(): Promise<unknown> {
		return new Promise((resolve, reject) => {
			pendingResolve = resolve;
			emitter.emit(DEBUG_INFO_REQUEST);
			setTimeout(() => {
				if (pendingResolve) {
					pendingResolve = undefined;
					pending = false;
					reject(new Error("This game's viewer doesn't support copying debug info."));
				}
			}, 4000);
		});
	}

	async function copyDebugInfo() {
		if (pending) {
			return;
		}
		pending = true;
		try {
			const data = await requestDebugInfo();
			await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
			notifier.success("Debug info copied to clipboard");
		} catch (err) {
			if (err instanceof Error && err.message.includes("doesn't support")) {
				notifier.info(err.message);
			} else {
				handleError(err);
			}
		} finally {
			pending = false;
		}
	}
</script>

<!-- Only offered with developer settings enabled: it's a debugging tool, and the
     payload (chosen by the game's viewer) can be verbose. -->
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
