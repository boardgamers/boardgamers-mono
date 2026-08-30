<!-- Test harness: mounts a <TimingSettings> with its bindable timing values driven
     by writable stores, so specs can assert what preset clicks write back and seed
     initial values (defaults vs a remembered custom setup). -->
<script lang="ts" module>
	import { writable } from "svelte/store";
	export const harTimePerGame = writable(3 * 24 * 3600);
	export const harTimePerMove = writable(2 * 3600);
</script>

<script lang="ts">
	import TimingSettings from "./TimingSettings.svelte";
</script>

<TimingSettings bind:timePerGame={$harTimePerGame} bind:timePerMove={$harTimePerMove} />
