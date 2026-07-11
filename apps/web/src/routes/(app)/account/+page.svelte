<script lang="ts">
  import { handleError, confirm, niceDate, duration, createWatcher } from "@/utils";
  import { Card, Button, FormGroup, Input, InputGroup, Checkbox } from "@/modules/cdk";
  import { upperFirst, debounce } from "lodash";
  import { account } from "@/lib/account.svelte";
  import { post, apiFetch } from "@/lib/api";
  import type { UserFront } from "@bgs/models";
  import { browser } from "$app/environment";
  import { developerSettings } from "@/lib/stores.svelte";
  import { useLoggedIn } from "@/lib/auth-guards.svelte";
  import UserAvatar from "@/components/User/UserAvatar.svelte";
  import { logoClick, imageCache } from "@/lib/stores.svelte";

  useLoggedIn();

  let email = $state($account!.account.email);
  let editingEmail = $state(false);
  let notifications = $state(browser ? !!localStorage.getItem("notifications") : false);
  let newsletter = $state($account!.settings?.mailing?.newsletter);
  let soundNotification = $state($account!.settings?.game?.soundNotification);
  let gameNotification = $state($account!.settings?.mailing?.game?.activated);
  let gameNotificationDelay = $state($account!.settings?.mailing?.game?.delay ?? 30 * 60);
  let tc = $state(false);
  let editingAvatar = $state(false);
  let fileUpload = $state<HTMLInputElement>();

  let bio = $derived($account?.account.bio ?? "");

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
    post<UserFront>("/account", {
      account: {
        avatar: art,
      },
    })
      .then((r) => account.set(r), handleError)
      .finally(() => (((editingAvatar = false), imageCache.set(Date.now())), logoClick()));

  const updateAccount = debounce(
    () => {
      post<UserFront>("/account", {
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
    post<UserFront>("/account", {
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

  let customAvatarError = $state(false);

  async function uploadAvatar(event: InputEvent) {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      return;
    }

    const resp = await apiFetch("/account/avatar", { method: "POST", body: file });
    if (!resp.ok) {
      handleError("Error during upload (" + resp.status + ")");
      return;
    }
    imageCache.set(Date.now());
    editingAvatar = false;
    customAvatarError = false;
  }

  $effect(() => {
    notifications;
    onNotificationsChanged();
  });
</script>

<svelte:head>
  <title>Account</title>
</svelte:head>

<div class="container mx-auto px-4">
  <div class="grid grid-cols-2">
    <div>
      <h1>{$account.account.username}</h1>
    </div>
    <div class="text-right">
      <Button color="primary" href={`/user/${$account.account.username}`}>Profile</Button>
    </div>
  </div>

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
      <input type="file" bind:this={fileUpload} onchange={uploadAvatar} accept="image/*" class="hidden" />
      <a href="#upload" style="width: 100%" role="button" onclick={(e) => { e.preventDefault(); fileUpload.click(); }}>Upload</a>
      <div style="display: contents" class:hidden={customAvatarError}>
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
      <span class="text-xs">{$account.security.confirmed ? "Your email is confirmed." : "Your email is not confirmed."}</span>
    </FormGroup>
    <p>
      Connect with

      {#each ["google", "discord", "facebook"] as social}
        <Button
          color="secondary"
          class={`mx-1 ${social}`}
          disabled={!!($account.account.social && $account.account.social[social])}
          href={`/api/account/auth/${social}`}
          aria-disabled={!!($account.account.social && $account.account.social[social])}
          rel="external"
        >
          {upperFirst(social)}
        </Button>
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
    <div class="flex flex-row items-center gap-3">
      <div class="flex-shrink-0">
        <Checkbox bind:checked={gameNotification} onchange={updateAccount}>
          Receive an email when it's your turn after a delay of
        </Checkbox>
      </div>
      <div class="flex-shrink-0">
        <select
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
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
</div>
