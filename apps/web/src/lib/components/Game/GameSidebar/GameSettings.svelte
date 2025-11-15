<script lang="ts">
  import Checkbox from "$lib/cdk/Checkbox.svelte";
  import { useAccount } from "$lib/composition/useAccount";
  import { useRest } from "$lib/composition/useRest";
  import type { GameContext } from "$lib/types/GameContext";
  import { handleError } from "$lib/utils/handle-stuff";
  import { oneLineMarked } from "$lib/utils/markdown";
  import IconInfoCircleFill from "@iconify-svelte/bi/info-circle-fill";
  import { FormGroup, Input, Label } from "@sveltestrap/sveltestrap";
  import { getContext } from "svelte";

  const { account } = useAccount();
  const { post, get } = useRest();

  const { game, gameInfo }: GameContext = getContext("game");
  let settings: Record<string, unknown> | null = null;

  $: userId = $account?._id;
  $: playerUser = $game?.players.find((pl) => pl._id === userId);
  $: gameStatus = $game?.status;
  $: gameId = $game?._id;

  async function loadSettings() {
    if (gameStatus !== "active" || !playerUser || !$gameInfo) {
      settings = null;
      return;
    }
    if ($gameInfo.settings?.length > 0) {
      settings = (await get<typeof settings>(`/gameplay/${gameId}/settings`).catch(handleError)) ?? null;
    } else {
      settings = null;
    }
  }

  $: (loadSettings(), [gameStatus, userId, $gameInfo]);

  async function postSettings() {
    if (!$account) {
      return;
    }
    await post(`/gameplay/${gameId}/settings`, settings as any);
  }
</script>

{#if $gameInfo?.settings?.length > 0 && $game.status === "active" && settings && playerUser}
  <div class="mt-75">
    <h3>
      Settings
      <a href={`/page/${$game.game.name}/settings`}>
        <IconInfoCircleFill class="small" />
      </a>
    </h3>
    <!-- Code very similar to PreferencesChooser -->
    {#each $gameInfo.settings as setting}
      {#if !setting.faction || setting.faction === playerUser.faction}
        {#if setting.type === "checkbox"}
          <Checkbox bind:checked={settings[setting.name]} onchange={postSettings}>
            {setting.label}
          </Checkbox>
        {:else if setting.type === "select"}
          <FormGroup class="d-flex align-items-center mt-2">
            <Label class="nowrap me-2 mb-0">{@html oneLineMarked(setting.label)}</Label>
            <Input type="select" bind:value={settings[setting.name]} onchange={postSettings} bsSize="sm">
              {#each setting.items as item}
                <option value={item.name}>{item.label}</option>
              {/each}
            </Input>
          </FormGroup>
        {/if}
      {/if}
    {/each}
  </div>
{/if}
