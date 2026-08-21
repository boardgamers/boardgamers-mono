<script lang="ts">
	import { page } from "$app/state";
	import { Button } from "@/modules/cdk";
	import { setAuthData, type AuthData } from "@/lib/account.svelte";
	import { post } from "@/lib/api";
	import { handleError, handleInfo } from "@/utils";
	import { m } from "@/lib/i18n/messages";

	async function resetPassword(params: { email: string; resetKey: string; password: string }): Promise<void> {
		return post<AuthData>("/account/reset", params).then(setAuthData);
	}

	let email = $state(page.url.searchParams.get("email") ?? page.url.searchParams.get("user") ?? "");
	let key = $state(page.url.searchParams.get("key")!);
	let password = $state("");
	let passwordConfirm = $state("");

	function handleSubmit() {
		if (password !== passwordConfirm) {
			handleError(m.auth_passwordsMismatch());
			return;
		}
		resetPassword({ email, resetKey: key, password }).then(() => handleInfo(m.auth_passwordReset()), handleError);
	}
</script>

<div class="container mx-auto px-4">
	<h1>{m.auth_resetPassword()}</h1>
	<form
		method="post"
		accept-charset="UTF-8"
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
	>
		<div class="mb-3">
			<label for="email">{m.common_email()}</label>
			<input
				type="email"
				class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
				id="email"
				placeholder={m.common_emailAddress()}
				bind:value={email}
				disabled
				required
			/>
		</div>
		<div class="flex flex-row gap-3">
			<div class="mb-3 flex-1">
				<label for="signup-password">{m.auth_password()}</label>
				<input
					type="password"
					class="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
					id="signup-password"
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
					bind:value={passwordConfirm}
					placeholder={m.auth_password()}
					required
				/>
			</div>
		</div>
		<Button type="submit" color="primary" class="mt-3 ml-auto">{m.auth_reset()}</Button>
	</form>
</div>
