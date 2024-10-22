<script lang="ts" context="module">
  import { AuthData, useAccount } from "@/composition/useAccount";
  import { useLoad } from "@/composition/useLoad";

  import { useRest } from "@/composition/useRest";
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    if (typeof window === "undefined") {
      // Bug in node 20+, handle client-side
      return {
        status: 200,
        body: {},
      };
    }
    const { post, setAuthData } = useLoad(input, useAccount, useRest);
    await post<AuthData>("/account/confirm", {
      key: input.url.searchParams.get("key"),
      email: input.url.searchParams.get("email"),
    }).then(setAuthData);

    return {
      status: 302,
      redirect: "/account",
    };
  }
</script>
