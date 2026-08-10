<script lang="ts">
	import { page } from "$app/state";
	import { Button, Container } from "@/modules/cdk";
	import { post } from "@/lib/api";
	import { handleError } from "@/utils";
	import type { ConsentInfo } from "./+page.server";

	let { data }: { data: { info: ConsentInfo } } = $props();

	let busy = $state<"approve" | "deny" | null>(null);

	const SCOPE_LABELS: Record<string, string> = {
		openid: "Sign you in (verify your identity)",
		profile: "Read your username and public profile",
		email: "Read your email address",
	};

	const authorizeParams = () => {
		const params: Record<string, string> = {};
		for (const [key, value] of page.url.searchParams) {
			params[key] = value;
		}
		return params;
	};

	async function decide(decision: "approve" | "deny") {
		busy = decision;
		try {
			const result = await post<{ authorizeUrl?: string; redirectUrl?: string }>("/oauth2/consent", {
				...authorizeParams(),
				decision,
			});
			const target = result.authorizeUrl ?? result.redirectUrl;
			if (target) {
				// Full navigation: approve resumes /api/oauth2/authorize (which 303s to the
				// client with its code); deny goes straight to the client's redirect_uri.
				window.location.href = target;
			}
		} catch (err) {
			busy = null;
			handleError(err);
		}
	}
</script>

<Container class="mx-auto max-w-lg py-8">
	<h1 class="mb-1 text-2xl font-semibold">Authorize application</h1>
	<p class="mb-6 text-sm text-gray-600 dark:text-gray-400">
		An application is asking to access your Boardgamers account.
	</p>

	<div class="rounded-md border border-gray-200 p-4 dark:border-gray-700">
		<p class="mb-1 text-lg font-medium">{data.info.clientName}</p>
		<p class="mb-4 text-sm break-all text-gray-500 dark:text-gray-400">{data.info.clientHost}</p>

		<p class="mb-2 text-sm font-medium">This application will be able to:</p>
		<ul class="mb-4 list-disc pl-6 text-sm">
			{#each data.info.scopes as scope (scope)}
				<li>{SCOPE_LABELS[scope] ?? scope}</li>
			{/each}
		</ul>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			The application is identified by <code class="break-all">{data.info.clientId}</code>. Only continue if you trust
			this application.
		</p>
	</div>

	<div class="mt-6 flex gap-3">
		<Button color="primary" disabled={busy !== null} onclick={() => decide("approve")}>
			{busy === "approve" ? "Authorizing…" : "Authorize"}
		</Button>
		<Button color="secondary" disabled={busy !== null} onclick={() => decide("deny")}>
			{busy === "deny" ? "Denying…" : "Deny"}
		</Button>
	</div>
</Container>
