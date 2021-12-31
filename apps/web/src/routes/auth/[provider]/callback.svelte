<script context="module" lang="ts">
  import { AuthData, useAccount } from "@/composition/useAccount";
  import { useLoad } from "@/composition/useLoad";
  import { useRest } from "@/composition/useRest";

  import type { LoadInput } from "@sveltejs/kit";

  export const ssr = false;

  export async function load(input: LoadInput) {
    const { get, setAuthData } = useLoad(input, useRest, useAccount);

    const response = await get<{ createSocialAccount: boolean } & AuthData>(
      `/account/auth/${input.params.provider}/callback`,
      input.url.searchParams
    );

    if (response.createSocialAccount) {
      return {
        redirect: "/signup?" + new URLSearchParams(response as any).toString(),
        status: 302,
      };
    }

    setAuthData(response);
    return {
      redirect: "/account",
      status: 302,
    };
  }
</script>
