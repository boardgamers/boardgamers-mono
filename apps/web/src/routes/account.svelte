<script lang="ts" context="module">
  export async function load(input: LoadInput) {
    const { loadGameInfos, account, loadAllGamePreferences } = useLoad(
      input,
      useAccount,
      useGameInfo,
      useGamePreferences
    );

    await loadGameInfos();
    await loadAllGamePreferences();

    if (!storeGet(account)) {
      return { status: 302, redirect: redirectLoggedIn(input.page) };
    }

    return {};
  }
</script>

<script lang="ts">
  import { handleError, confirm, niceDate, duration, createWatcher } from "@/utils";
  import { UserGameSettings } from "@/components";
  import { Card, Button, Col, Container, FormGroup, Input, InputGroup, Row, Checkbox } from "@/modules/cdk";
  import { upperFirst, debounce } from "lodash";
  import type { LoadInput } from "@sveltejs/kit";
  import { useLoad } from "@/composition/useLoad";
  import { useAccount } from "@/composition/useAccount";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { useRest } from "@/composition/useRest";
  import { get as storeGet } from "svelte/store";
  import { redirectLoggedIn } from "@/utils/redirect";
  import type { IUser } from "@bgs/types";
  import { browser } from "$app/env";
  import { useDeveloperSettings } from "@/composition/useDeveloperSettings";
  import { useGamePreferences } from "@/composition/useGamePreferences";
  import { useLoggedIn } from "@/composition/useLoggedIn";

  useLoggedIn();

  const { latestGameInfos } = useGameInfo();
  const { developerSettings } = useDeveloperSettings();
  const { account } = useAccount();
  const { post } = useRest();

  let games = latestGameInfos();

  let email = $account!.account.email;
  let editingEmail = false;
  let notifications = browser ? !!localStorage.getItem("notifications") : false;
  let newsletter = $account!.settings?.mailing?.newsletter;
  let soundNotification = $account!.settings?.game?.soundNotification;
  let gameNotification = $account!.settings?.mailing?.game?.activated;
  let gameNotificationDelay = $account!.settings?.mailing?.game?.delay ?? 30 * 60;
  let tc = false;

  async function acceptTC() {
    const accepted = await confirm("The terms and conditions will be marked as accepted at today's date.");

    if (!accepted) {
      tc = false;
      return;
    }

    try {
      account.set(await post("/account/terms-and-conditions"));
    } catch (err) {
      handleError(err);
    }
  }

  const updateAccount = debounce(
    () => {
      post<IUser>("/account", {
        settings: {
          mailing: {
            newsletter,
            game: {
              activated: gameNotification,
              delay: gameNotificationDelay,
            },
          },
          game: {
            soundNotification,
          },
        },
      }).then((r) => account.set(r), handleError);
    },
    800,
    { leading: false }
  );

  async function saveEmail() {
    try {
      account.set(await post("/account/email", { email }));
    } catch (err) {
      handleError(err);
    }
  }

  const onNotificationsChanged = createWatcher(() => {
    if (notifications) {
      if (Notification.permission !== "granted") {
        Notification.requestPermission();
      }
    }

    if (!!localStorage.getItem("notifications") !== notifications) {
      localStorage.setItem("notifications", notifications ? "1" : "");
    }
  });

  $: onNotificationsChanged(), [notifications];
</script>

{#if $account}
  <Container>
    <Row>
      <Col>
        <h1>{$account.account.username}</h1>
      </Col>
      <Col class="text-end">
        <a class="btn btn-primary" href={`/user/${$account.account.username}`} role="button">Profile</a>
      </Col>
    </Row>

    <div class="row row-cols-1 row-cols-md-3 g-4 mt-4 game-choice">
      {#each games as game}
        <Col>
          <UserGameSettings {game} class="h-100" />
        </Col>
      {/each}
    </div>

    <Card class="mt-4 border-info" header="User Settings">
      <p>
        Username: <strong>{$account.account.username}</strong>
      </p>
      <FormGroup>
        <label for="email">Email</label>
        <InputGroup>
          <Input
            type="email"
            placeholder="Email address"
            bind:value={email}
            on:keyup={(e) => {
              if (e.code === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                saveEmail();
              }
            }}
            disabled={!editingEmail}
          />

          {#if !editingEmail}
            <Button outline color="secondary" on:click={() => (editingEmail = true)}>Edit</Button>
          {:else}
            <Button outline color="success" on:click={saveEmail}>Save</Button>
          {/if}
        </InputGroup>
        <small>{$account.security.confirmed ? "Your email is confirmed." : "Your email is not confirmed."}</small>
      </FormGroup>
      <p>
        Connect with

        {#each ["google", "discord", "facebook"] as social}
          <a
            class={`btn btn-secondary mx-1 ${social}`}
            class:disabled={!!($account.account.social && $account.account.social[social])}
            href={`/api/account/auth/${social}`}
            aria-disabled={!!($account.account.social && $account.account.social[social])}
            role="button"
            rel="external"
          >
            {upperFirst(social)}
          </a>
        {/each}
      </p>
      {#if !$account.account.termsAndConditions}
        <Checkbox bind:checked={tc} on:change={acceptTC} class="mb-3">
          I agree to the <a href="/page/terms-and-conditions">Terms and Conditions</a> 📝
        </Checkbox>
      {:else}
        <p>
          I accepted the <a href="/page/terms-and-conditions">Terms and Conditions</a> on
          {niceDate($account.account.termsAndConditions)}.
        </p>
      {/if}
      <hr />
      <Checkbox bind:checked={newsletter} on:change={updateAccount}>Get newsletter, up to six emails per year.</Checkbox
      >
      <div class="form-row align-items-center">
        <div class="col-auto">
          <Checkbox bind:checked={gameNotification} on:change={updateAccount}>
            Receive an email when it's your turn after a delay of
          </Checkbox>
        </div>
        <div class="col-auto">
          <select
            class="form-control form-control-sm"
            bind:value={gameNotificationDelay}
            on:blur={() => {
              gameNotification = true;
              updateAccount();
            }}
          >
            {#each [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600] as seconds}
              <option value={seconds}>
                {duration(seconds)}
              </option>
            {/each}
          </select>
        </div>
      </div>
      <hr />
      <Checkbox bind:checked={$developerSettings}>🔧 Enable developper settings on this device</Checkbox>
    </Card>
    <Card class="mt-4 border-info" header="Game Settings">
      <Checkbox bind:checked={soundNotification} on:change={updateAccount}>
        Play a sound when it's your turn in one of your games
      </Checkbox>
      <Checkbox bind:checked={notifications}>Notification on this device when it's your turn</Checkbox>
    </Card>
  </Container>
{/if}
