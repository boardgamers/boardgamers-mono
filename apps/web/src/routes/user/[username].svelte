<script context="module" lang="ts">
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    const { get, loadGames } = useLoad(input, useRest, useGames);

    const user = await get<IUser>(`/user/infoByName/${encodeURIComponent(input.page.params.username)}`);

    if (!user) {
      return {
        status: 404,
        error: new Error("User not found"),
      };
    }

    await Promise.all([
      loadGames({ userId: user._id, gameStatus: "active", count: 5, store: true }),
      loadGames({ userId: user._id, gameStatus: "open", count: 5, store: true }),
      loadGames({ userId: user._id, gameStatus: "ended", count: 5, store: true }),
    ]);

    return {
      props: {
        user,
      },
    };
  }
</script>

<script lang="ts">
  import type { IUser } from "@bgs/types";
  import { UserGames, UserElo, SEO, UserAvatar } from "@/components";
  import { Row, Col, Container, Card } from "@/modules/cdk";
  import { useLoad } from "@/composition/useLoad";
  import { useRest } from "@/composition/useRest";
  import { useAccount } from "@/composition/useAccount";
  import { dateFromObjectId } from "@/utils";
  import { page } from "$app/stores";
  import { useGames } from "@/composition/useGames";

  const { accountId } = useAccount();

  export let user: IUser;
  $: username = user.account.username;
  $: joinDate = user && dateFromObjectId(user._id);
</script>

<SEO
  title={`${username}'s profile`}
  description={user.account.bio ||
    `${username} joined in ${dateFromObjectId(user._id).toLocaleString("en", {
      month: "long",
    })} ${dateFromObjectId(user._id).toLocaleString("en", { year: "numeric" })} and has ${user.account.karma} karma.`}
  image={`https://${$page.host}/api/user/${user._id}/avatar`}
/>

<Container>
  <div class="user-layout">
    <div class="user-info">
      <UserAvatar
        username={user.account.username}
        --avatar-border="1px solid gray"
        userId={user._id}
        --avatar-size="8rem"
      />
      <h1>{username}</h1>
      <div>
        ☯️ <a href="/page/karma" title="karma">{user.account.karma}</a> karma <br />
        🎉 Joined us in {joinDate.toLocaleString("en", { month: "long" })}
        {joinDate.toLocaleString("default", { year: "numeric" })}!
      </div>
      {#if user.account.bio}<p class="mt-2" title={`${user.account.username}'s bio`}>📝 {user.account.bio}</p>{/if}
      {#if user && $accountId === user._id}
        <a class="btn btn-primary" href="/account" role="button">Settings</a>
      {/if}
    </div>
    <div style="flex-grow: 3">
      <UserGames userId={user._id} />

      <Card class="border-secondary mt-4" header="Statistics">
        <Row>
          <Col lg={6} class="mb-3">
            <UserElo userId={user._id} />
          </Col>
          <Col>
            <h3 class="card-title">Tournaments</h3>
            <p>No Tournament info available</p>
          </Col>
        </Row>
      </Card>
    </div>
  </div>
</Container>

<style lang="postcss">
  @media (min-width: 768px) {
    .user-info {
      width: 256px;
      min-width: 256px;
      margin-right: 0.5rem;
    }
  }
  .user-layout {
    display: flex;

    @media (max-width: 767.98px) {
      flex-direction: column;
    }
  }
</style>
