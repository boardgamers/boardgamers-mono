<script lang="ts">
  import { Checkbox, Label, Input, FormGroup } from "@/modules/cdk";
  import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";
  import { handleError, oneLineMarked } from "@/utils";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import { getContext } from "svelte";
  import { account } from "@/lib/stores.svelte";
  import { post, get } from "@/lib/api";

  const { game, gameInfo }: GameContext = getContext("game");
  let settings = $state<Record<string, unknown> | null>(null);

  let userId = $derived($account?._id);
  let playerUser = $derived(game?.players.find((pl) => pl._id === userId));
  let gameStatus = $derived(game?.status);
  let gameId = $derived(game?._id);

  async function loadSettings() {
    if (gameStatus !== "active" || !playerUser || !gameInfo) {
      settings = null;
      return;
    }
    if (gameInfo.settings?.length > 0) {
      settings = (await get<typeof settings>(`/gameplay/${gameId}/settings`).catch(handleError)) ?? null;
    } else {
      settings = null;
    }
  }

  // Initial load: run synchronously during component init so SSR has data.
  loadSettings();

  let firstRun = true;

  $effect(() => {
    gameStatus;
    userId;
    gameInfo;
    // Skip the first run — initial load already happened synchronously above.
    if (firstRun) {
      firstRun = false;
      return;
    }
    loadSettings();
  });

  async function postSettings() {
    if (!$account) {
      return;
    }
    await post(`/gameplay/${gameId}/settings`, settings as any);
  }
</script>

{#if game && gameInfo?.settings?.length > 0 && game.status === "active" && settings && playerUser}
  <div class="mt-3">
    <h3>
      Settings
      <a href={`/page/${game.game.name}/settings`}>
        <IconInfoCircleFill class="text-xs" />
      </a>
    </h3>
    <!-- Code very similar to PreferencesChooser -->
    {#each gameInfo.settings as setting}
      {#if !setting.faction || setting.faction === playerUser.faction}
        {#if setting.type === "checkbox"}
          <Checkbox bind:checked={settings[setting.name]} onchange={postSettings}>
            {setting.label}
          </Checkbox>
        {:else if setting.type === "select"}
          <FormGroup class="flex items-center mt-2">
            <Label class="whitespace-nowrap me-2 mb-0">{@html oneLineMarked(setting.label)}</Label>
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
