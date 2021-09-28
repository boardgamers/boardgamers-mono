<script lang="ts">
  import { handleError, confirm, niceDate, duration, createWatcher } from "@/utils";
  import { UserGameSettings } from "@/components";
  import { Card, Button, Col, Container, FormGroup, Input, InputGroup, Row, Checkbox } from "@/modules/cdk";
  import { boardgames, user, developerSettings } from "@/store";
  import { routePath } from "@/modules/router";
  import { upperFirst, debounce } from "lodash";
  import { latestBoardgames, loadBoardgames, post } from "@/api";
  import type { GameInfo } from "@bgs/types";

  loadBoardgames().catch(handleError);

  let games: GameInfo[];
  $: (games = latestBoardgames() as GameInfo[]), [$boardgames];

  let email = $user!.account.email;
  let editingEmail = false;
  let notifications = !!localStorage.getItem("notifications");
  let newsletter = $user!.settings?.mailing?.newsletter;
  let soundNotification = $user!.settings?.game?.soundNotification;
  let gameNotification = $user!.settings?.mailing?.game?.activated;
  let gameNotificationDelay = $user!.settings?.mailing?.game?.delay ?? 30 * 60;
  let tc = false;

  async function acceptTC() {
    const accepted = await confirm("The terms and conditions will be marked as accepted at today's date.");

    if (!accepted) {
      tc = false;
      return;
    }

    try {
      user.set(await post("/account/terms-and-conditions"));
    } catch (err) {
      handleError(err);
    }
  }

  const updateAccount = debounce(
    () => {
      post("/account", {
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
      }).then((r) => user.set(r), handleError);
    },
    800,
    { leading: false }
  );

  async function saveEmail() {
    try {
      user.set(await post("/account/email", { email }));
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

  $: onNotificationsChanged(notifications);
</script>

{#if $user}
  <Container>
    <Row>
      <Col>
        <h1>{$user.account.username}</h1>
      </Col>
      <Col class="text-end">
        <a
          class="btn btn-primary"
          href={routePath({ name: "user", params: { username: $user.account.username } })}
          role="button">Profile</a
        >
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
        Username: <strong>{$user.account.username}</strong>
      </p>
      <FormGroup>
        <label for="email">Email</label>
        <InputGroup>
          <Input
            type="email"
            placeholder="Email address"
            bind:value={email}
            on:keyup={(e) => {
              if (e.keyCode === 13) {
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
        <small>{$user.security.confirmed ? "Your email is confirmed." : "Your email is not confirmed."}</small>
      </FormGroup>
      <p>
        Connect with

        {#each ["google", "discord", "facebook"] as social}
          <a
            class={`btn btn-secondary mx-1 ${social}`}
            class:disabled={!!($user.account.social && $user.account.social[social])}
            href={`/api/account/auth/${social}`}
            aria-disabled={!!($user.account.social && $user.account.social[social])}
            role="button"
            rel="external"
          >
            {upperFirst(social)}
          </a>
        {/each}
      </p>
      {#if !$user.account.termsAndConditions}
        <Checkbox bind:checked={tc} on:change={acceptTC} class="mb-3">
          I agree to the <a href="/page/terms-and-conditions">Terms and Conditions</a> 📝
        </Checkbox>
      {:else}
        <p>
          I accepted the <a href="/page/terms-and-conditions">Terms and Conditions</a> on
          {niceDate($user.account.termsAndConditions)}.
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
