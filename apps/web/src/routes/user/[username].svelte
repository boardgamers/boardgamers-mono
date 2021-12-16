<script context="module" lang="ts">
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    const { get } = useLoad(input, useRest);

    const user = await get<IUser>(`/user/infoByName/${encodeURIComponent(input.page.params.username)}`);

    if (!user) {
      return {
        status: 404,
        error: new Error("User not found"),
      };
    }

    return {
      props: {
        user,
      },
    };
  }
</script>

<script lang="ts">
  import type { IUser } from "@bgs/types";
  import { UserGames, UserPublicInfo, UserElo, SEO } from "@/components";
  import { Row, Col, Container, Card, Loading } from "@/modules/cdk";
  import { useLoad } from "@/composition/useLoad";
  import { useRest } from "@/composition/useRest";
  import { useAccount } from "@/composition/useAccount";
  import { dateFromObjectId } from "@/utils";

  const { accountId } = useAccount();

  export let user: IUser;
  $: username = user.account.username;
</script>

<SEO
  title={`${username}'s profile`}
  description={`${username} joined in ${dateFromObjectId(user._id).toLocaleString("en", {
    month: "long",
  })} ${dateFromObjectId(user._id).toLocaleString("en", { year: "numeric" })} and has ${user.account.karma} karma.`}
/>

<Container>
  <Row>
    <Col>
      <h1>{username}</h1>
    </Col>
    <Col class="text-end">
      {#if user && $accountId === user._id}
        <a class="btn btn-primary" href="/account" role="button">Settings</a>
      {/if}
    </Col>
  </Row>
  <Loading loading={!user}>
    <UserPublicInfo class="mt-4" {user} />
    <UserGames userId={user._id} />

    <Card class="border-info mt-4" header="Statistics">
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
  </Loading>
</Container>
