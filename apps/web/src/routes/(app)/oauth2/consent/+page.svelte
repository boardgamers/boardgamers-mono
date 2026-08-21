<script lang="ts">
	import { page } from "$app/state";
	import { Button, Container } from "@/modules/cdk";
	import IconGlobe from "@/components/icons/IconGlobe.svelte";
	import IconPerson from "@/components/icons/IconPerson.svelte";
	import { post } from "@/lib/api";
	import { handleError } from "@/utils";
	import type { ConsentInfo } from "./+page.server";
	import { m } from "@/lib/i18n/messages";

	let { data }: { data: { info: ConsentInfo } } = $props();

	let busy = $state<"approve" | "deny" | null>(null);
	let logoFailed = $state(false);

	type ScopeDescription = { title: string; description: string; icon: "identity" | "profile" | "email" };

	// Scope copy resolves per render so a language switch re-labels in place.
	let SCOPE_INFO = $derived<Record<string, ScopeDescription>>({
		openid: {
			title: m.oauth_scope_openid_title(),
			description: m.oauth_scope_openid_description(),
			icon: "identity",
		},
		profile: {
			title: m.oauth_scope_profile_title(),
			description: m.oauth_scope_profile_description(),
			icon: "profile",
		},
		email: {
			title: m.oauth_scope_email_title(),
			description: m.oauth_scope_email_description(),
			icon: "email",
		},
		role: {
			title: m.oauth_scope_role_title(),
			description: m.oauth_scope_role_description(),
			icon: "identity",
		},
	});

	const scopeInfo = (scope: string): ScopeDescription =>
		SCOPE_INFO[scope] ?? { title: scope, description: "", icon: "identity" };

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

<Container class="mx-auto max-w-xl px-4 py-6 sm:py-10">
	<div
		class="rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800"
		aria-busy={busy !== null}
	>
		<div class="px-5 pb-5 pt-6 text-center sm:px-8 sm:pt-8">
			<div
				class="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-50 text-primary dark:border-gray-600 dark:bg-gray-700 dark:text-primary-lighter"
			>
				{#if data.info.logoUri && !logoFailed}
					<!-- The API only forwards https logo URIs (CIMD schema); clientName stays text-escaped. -->
					<img
						src={data.info.logoUri}
						alt=""
						class="h-full w-full object-cover"
						referrerpolicy="no-referrer"
						onerror={() => (logoFailed = true)}
					/>
				{:else}
					<IconGlobe size="1.75rem" />
				{/if}
			</div>
			<h1 class="mt-4 text-2xl font-bold">{m.oauth_authorize({ client: data.info.clientName })}</h1>
			<p class="mt-1 break-all text-sm text-gray-500 dark:text-gray-400">{data.info.clientHost}</p>
		</div>

		<div class="border-t border-gray-200 px-5 py-5 dark:border-gray-700 sm:px-8">
			<h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
				{m.oauth_willBeAble()}
			</h2>
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each data.info.scopes as scope (scope)}
					{@const info = scopeInfo(scope)}
					<li class="flex items-center gap-3 py-2.5">
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
							aria-hidden="true"
						>
							{#if info.icon === "profile"}
								<IconPerson size="1.1rem" />
							{:else if info.icon === "email"}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									width="1.1rem"
									height="1.1rem"
									fill="currentColor"
								>
									<path
										d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2zm13 2.383-4.708 2.825L15 11.105V5.383zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741zM1 11.105l4.708-2.897L1 5.383v5.722z"
									/>
								</svg>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									width="1.1rem"
									height="1.1rem"
									fill="currentColor"
								>
									<path
										d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"
									/>
								</svg>
							{/if}
						</span>
						<span class="min-w-0">
							<span class="block text-sm font-medium">{info.title}</span>
							{#if info.description}
								<span class="block text-xs text-gray-500 dark:text-gray-400">{info.description}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</div>

		<div class="border-t border-gray-200 px-5 py-5 dark:border-gray-700 sm:px-8">
			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<Button
					color="secondary"
					outline
					class="w-full sm:w-auto"
					disabled={busy !== null}
					aria-label={m.oauth_denyAria({ client: data.info.clientName })}
					onclick={() => decide("deny")}
				>
					{busy === "deny" ? m.oauth_denying() : m.oauth_deny()}
				</Button>
				<Button
					color="primary"
					class="w-full sm:w-auto"
					disabled={busy !== null}
					aria-label={m.oauth_authorizeAria({ client: data.info.clientName })}
					onclick={() => decide("approve")}
				>
					{busy === "approve" ? m.oauth_authorizing() : m.oauth_authorizeButton()}
				</Button>
			</div>
			<p class="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
				{m.oauth_trustWarning({ clientId: data.info.clientId })}
			</p>
		</div>
	</div>
</Container>
