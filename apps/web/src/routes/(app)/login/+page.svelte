<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { enhance } from "$app/forms";
	import { Button, FormGroup, Label } from "@/modules/cdk";
	import { handleError } from "@/utils";
	import { useLoggedOut } from "@/lib/auth-guards.svelte";
	import { login } from "@/lib/account.svelte";
	import { m } from "@/lib/i18n/messages";

	useLoggedOut();

	let email = $state("");
	let password = $state("");

	// Login failures (social OAuth, #155, or a no-JS bad-credentials post from the
	// form action) bounce back here as /login?error=….
	const loginError = page.url.searchParams.get("error");

	/**
	 * Progressive enhancement: JS intercepts the native POST to this page's action and
	 * keeps the fetch-based login (instant store seed, no navigation). Without JS the
	 * browser submits a plain POST and the action sets the session cookie server-side.
	 */
	function enhanceLogin({ cancel }: { cancel: () => void }) {
		cancel();
		login(email, password).catch(handleError);
	}
</script>

<div class="container mx-auto px-4">
	{#if loginError}
		<div
			class="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
			role="alert"
		>
			{m.auth_loginFailed({ error: loginError })}
		</div>
	{/if}
	<form method="POST" use:enhance={enhanceLogin}>
		<FormGroup>
			<Label for="email">{m.auth_emailOrUsername()}</Label>
			<input
				bind:value={email}
				type="text"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
				id="email"
				name="email"
				placeholder={m.auth_emailOrUsernamePlaceholder()}
				required
			/>
		</FormGroup>
		<FormGroup>
			<Label for="password">{m.auth_password()}</Label>
			<input
				type="password"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
				id="password"
				name="password"
				placeholder={m.auth_password()}
				bind:value={password}
				required
			/>
			<div class="mt-1 text-right">
				<a href={resolve("/(app)/forgotten-password")}><span class="text-xs">{m.auth_forgottenPassword()}</span></a>
			</div>
		</FormGroup>
		<div class="mt-3">
			<Button type="submit" color="primary" class="ml-auto">{m.auth_login()}</Button>
		</div>
	</form>

	<hr />

	<p class="mt-3">{m.auth_needAccount()} <a href={resolve("/(app)/signup")}>{m.auth_register()}</a></p>

	<!-- Facebook phase-out step 1 (codeberg boardgamers#99): the social button row (appbar
	     dropdown) is shared by login and signup, so the Facebook button stays for existing
	     users — this note explains why new accounts can't use it. -->
	<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">{m.auth_facebookPhaseout()}</p>
</div>
