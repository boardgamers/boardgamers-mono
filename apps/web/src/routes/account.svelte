<script lang="ts" context="module">
  export async function load(input: LoadInput) {
    const { account } = useLoad(input, useAccount);

    if (!storeGet(account)) {
      return { status: 302, redirect: redirectLoggedIn(input.url) };
    }

    return {};
  }
</script>

<script lang="ts">
  import { browser } from "$app/environment";
  import { Button, Card, Checkbox, Col, Container, FormGroup, Input, InputGroup, Row } from "$cdk";
  import UserAvatar from "$lib/components/User/UserAvatar.svelte";
  import { useAccount } from "$lib/composition/useAccount";
  import { useDeveloperSettings } from "$lib/composition/useDeveloperSettings";
  import { useImageCache } from "$lib/composition/useImageCache";
  import { useLoad } from "$lib/composition/useLoad";
  import { useLoggedIn } from "$lib/composition/useLoggedIn";
  import { useLogoClicks } from "$lib/composition/useLogoClicks";
  import { useRest } from "$lib/composition/useRest";
  import { confirm, createWatcher, duration, handleError, niceDate } from "@/utils";
  import { redirectLoggedIn } from "@/utils/redirect";
  import type { IUser } from "@bgs/types";
  import type { LoadInput } from "@sveltejs/kit";
  import { debounce, upperFirst } from "lodash";
  import { get as storeGet } from "svelte/store";

  useLoggedIn();

  const { logoClick } = useLogoClicks();
  const { developerSettings } = useDeveloperSettings();
  const { account } = useAccount();
  const { imageCache } = useImageCache();
  const { post, fetch } = useRest();

  let email = $account!.account.email;
  let editingEmail = false;
  let notifications = browser ? !!localStorage.getItem("notifications") : false;
  let newsletter = $account!.settings?.mailing?.newsletter;
  let soundNotification = $account!.settings?.game?.soundNotification;
  let gameNotification = $account!.settings?.mailing?.game?.activated;
  let gameNotificationDelay = $account!.settings?.mailing?.game?.delay ?? 30 * 60;
  let tc = false;
  let editingAvatar = false;
  let fileUpload: HTMLInputElement;

  $: bio = $account?.account.bio ?? "";

  const avatarStyles = [
    "adventurer",
    "adventurer-neutral",
    "avataaars",
    "big-ears",
    "big-ears-neutral",
    "big-smile",
    "bottts",
    "croodles",
    "croodles-neutral",
    "gridy",
    "identicon",
    "initials",
    "jdenticon",
    "micah",
    "miniavs",
    "open-peeps",
    "personas",
    "pixel-art",
    "pixel-art-neutral",
  ];

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

  const selectArt = (art: string) =>
    post<IUser>("/account", {
      account: {
        avatar: art,
      },
    })
      .then((r) => account.set(r), handleError)
      .finally(() => (((editingAvatar = false), imageCache.set(Date.now())), logoClick()));

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

  const updateBio = (bio: string) =>
    post<IUser>("/account", {
      account: {
        bio,
      },
    }).then((r) => account.set(r), handleError);

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

  let customAvatarError = false;

  async function uploadAvatar(event: InputEvent) {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      return;
    }

    const resp = await fetch("/account/avatar", { method: "POST", body: file });
    if (!resp.ok) {
      handleError("Error during upload (" + resp.status + ")");
      return;
    }
    imageCache.set(Date.now());
    editingAvatar = false;
    customAvatarError = false;
  }

  $: (onNotificationsChanged(), [notifications]);
</script>

<svelte:head>
  <title>Account</title>
</svelte:head>

<Container>
  <Row>
    <Col>
      <h1>{$account.account.username}</h1>
    </Col>
    <Col class="text-end">
      <a class="btn btn-primary" href="/user/{$account.account.username}" role="button">Profile</a>
    </Col>
  </Row>

  <Card class="mt-4 border-accent" header="User Settings">
    {#if !editingAvatar}
      <UserAvatar
        --avatar-border="1px solid gray"
        role="button"
        onclick={() => (editingAvatar = true)}
        userId={$account._id}
        username={$account.account.username}
      />
    {:else}
      <input type="file" bind:this={fileUpload} onchange={uploadAvatar} accept="image/*" class="d-none" />
      <a href="#upload" style="width: 100%" role="button" onclick|preventDefault={() => fileUpload.click()}>Upload</a>
      <div style="display: contents" class:d-none={customAvatarError}>
        <UserAvatar
          userId="me"
          username="Custom avatar"
          role="button"
          onerror={() => (customAvatarError = true)}
          onload={() => (customAvatarError = false)}
          onclick={() => selectArt("upload")}
        />
      </div>
      {#each avatarStyles as art}
        <UserAvatar {art} username={$account.account.username} role="button" onclick={() => selectArt(art)} />
      {/each}
    {/if}
    <FormGroup class="mt-2">
      <label for="bio">Bio</label>
      <Input
        type="textarea"
        id="bio"
        placeholder="Something about yourself..."
        value={bio}
        onchange={(event) => updateBio(event.target.value)}
      />
    </FormGroup>
    <FormGroup class="mt-2">
      <label for="email">Email</label>
      <InputGroup>
        <Input
          type="email"
          id="email"
          placeholder="Email address"
          bind:value={email}
          onkeyup={(e) => {
            if (e.code === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              saveEmail();
            }
          }}
          disabled={!editingEmail}
        />

        {#if !editingEmail}
          <Button outline color="secondary" onclick={() => (editingEmail = true)}>Edit</Button>
        {:else}
          <Button outline color="success" onclick={saveEmail}>Save</Button>
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
      <Checkbox bind:checked={tc} onchange={acceptTC} class="mb-3">
        I agree to the <a href="/page/terms-and-conditions">Terms and Conditions</a> 📝
      </Checkbox>
    {:else}
      <p>
        I accepted the <a href="/page/terms-and-conditions">Terms and Conditions</a> on
        {niceDate($account.account.termsAndConditions)}.
      </p>
    {/if}
    <hr />
    <Checkbox bind:checked={newsletter} onchange={updateAccount}>Get newsletter, up to six emails per year.</Checkbox>
    <div class="form-row align-items-center">
      <div class="col-auto">
        <Checkbox bind:checked={gameNotification} onchange={updateAccount}>
          Receive an email when it's your turn after a delay of
        </Checkbox>
      </div>
      <div class="col-auto">
        <select
          class="form-control form-control-sm"
          bind:value={gameNotificationDelay}
          onblur={() => {
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
  <Card class="mt-4 border-accent" header="Game Settings">
    <Checkbox bind:checked={soundNotification} onchange={updateAccount}>
      Play a sound when it's your turn in one of your games
    </Checkbox>
    <Checkbox bind:checked={notifications}>Notification on this device when it's your turn</Checkbox>
  </Card>
</Container>
