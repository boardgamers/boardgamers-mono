<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { Button } from "@/modules/cdk";
	import { setAuthData, type AuthData } from "@/lib/account.svelte";
	import { useLoggedOut } from "@/lib/auth-guards.svelte";
	import { post } from "@/lib/api";
	import Checkbox from "@/modules/cdk/Checkbox.svelte";
	import { handleError } from "@/utils";
	import { m } from "@/lib/i18n/messages";

	useLoggedOut();

	let email = $state(page.url.searchParams.get("user") ?? "");
	// Social signup arrives either with a server-side `ticket` (redirect-only flow, #155)
	// or the legacy query params (createSocialAccount + jwt) from the old interstitial.
	let ticket = page.url.searchParams.get("ticket");
	let isSocial = ticket !== null || page.url.searchParams.get("createSocialAccount") !== null;

	let password = $state("");
	let passwordConfirm = $state("");
	let username = $state("");
	let newsletter = $state(false);
	let tc = $state(false);

	async function register(params: {
		email: string;
		username: string;
		password: string;
		newsletter: boolean;
		termsAndConditions: boolean;
	}): Promise<void> {
		return post<AuthData>("/account/signup", params).then(setAuthData);
	}

	async function registerSocial(params: {
		username: string;
		termsAndConditions: boolean;
		jwt?: string;
		ticket?: string;
	}): Promise<void> {
		return post<AuthData>("/account/signup/social", params).then(setAuthData);
	}

	function handleSubmit() {
		if (!tc) {
			handleError(m.auth_termsError());
			return;
		}

		if (isSocial) {
			registerSocial({
				username,
				termsAndConditions: tc,
				...(ticket ? { ticket } : { jwt: page.url.searchParams.get("jwt")! }),
			}).catch(handleError);
		} else {
			if (password !== passwordConfirm) {
				handleError(m.auth_passwordsMismatch());
				return;
			}

			register({ email, password, newsletter, username, termsAndConditions: tc }).catch(handleError);
		}
	}
</script>

<div class="container mx-auto px-4">
	<h1>{m.auth_createAccount()}</h1>
	<form
		method="post"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
	>
		<div class="mb-3">
			<label for="signup-username">{m.auth_username()}</label>
			<input
				type="text"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
				id="signup-username"
				name="username"
				placeholder={m.auth_username()}
				aria-describedby="usernameHelp"
				bind:value={username}
				required
			/>
			{#if isSocial}
				<small id="usernameHelp" class="text-xs text-gray-500 dark:text-gray-400">
					{m.auth_socialUsernameHelp()}
				</small>
			{/if}
		</div>
		{#if !isSocial}
			<div class="mb-3">
				<label for="signup-email">{m.auth_emailAddress()}</label>
				<input
					type="email"
					class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
					id="signup-email"
					name="email"
					placeholder={m.common_email()}
					aria-describedby="emailHelp"
					bind:value={email}
					required
				/>
				<small id="emailHelp" class="text-xs text-gray-500 dark:text-gray-400">
					{m.auth_emailHelp()}
				</small>
			</div>
			<div class="flex flex-row gap-3">
				<div class="mb-3 flex-1">
					<label for="signup-password">{m.auth_password()}</label>
					<input
						type="password"
						class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						id="signup-password"
						name="password"
						placeholder={m.auth_password()}
						bind:value={password}
						required
					/>
				</div>
				<div class="mb-3 flex-1">
					<label for="signup-password-confirm"
						>{m.auth_confirm()} <span class="md:hidden">{m.auth_password()}</span></label
					>
					<input
						type="password"
						class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						id="signup-password-confirm"
						name="password-confirm"
						placeholder={m.auth_password()}
						bind:value={passwordConfirm}
						required
					/>
				</div>
			</div>
			<div class="mt-2">
				<Checkbox bind:checked={newsletter}>{m.auth_newsletter()}</Checkbox>
			</div>
		{/if}

		<div class="mt-3 space-y-2">
			<Checkbox bind:checked={tc}>
				{m.auth_agreeTerms()}
				<a href={resolve("/(app)/page/[part1]", { part1: "terms-and-conditions" })} target="_blank"
					>{m.auth_termsAndConditions()}</a
				>.
			</Checkbox>

			<Button id="signup-button" class="ml-auto" type="submit" color="primary">{m.auth_register()}</Button>
		</div>
	</form>

	<hr />

	<div class="mt-3 space-y-1">
		<p>{m.auth_haveAccount()} <a href={resolve("/(app)/login")}>{m.common_logIn()}</a></p>
		<p>{m.auth_orGoBack()} <a href={resolve("/(app)")}>{m.auth_home()}</a>.</p>
	</div>
</div>
