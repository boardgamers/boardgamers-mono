<script lang="ts">
	import { resolve } from "$app/paths";
	import { Button } from "@/modules/cdk";
	import { useLoggedOut } from "@/lib/auth-guards.svelte";
	import { post } from "@/lib/api";
	import { handleError, handleInfo } from "@/utils";
	import { m } from "@/lib/i18n/messages";

	useLoggedOut();
	let email = $state("");
	function handleSubmit() {
		post("/account/forget", { email }).then(() => handleInfo(m.auth_resetEmailSent()), handleError);
	}
</script>

<div class="container mx-auto px-4">
	<h1>{m.auth_forgottenPasswordTitle()}</h1>
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
				required
			/>
		</div>
		<div class="mt-3">
			<Button type="submit" color="primary" class="ml-auto">{m.auth_reset()}</Button>
		</div>
	</form>
	<hr />
	<div class="mt-3 space-y-1">
		<p>{m.auth_needAccount()} <a href={resolve("/(app)/signup")}>{m.auth_register()}</a></p>
		<p>{m.auth_orGoBack()} <a href={resolve("/(app)")}>{m.auth_home()}</a>.</p>
	</div>
</div>
