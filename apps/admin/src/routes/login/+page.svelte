<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { setAuth } from "$lib/auth.svelte.ts";
	import { toast } from "$lib/toast.svelte.ts";

	let email = $state("");
	let password = $state("");
	let submitting = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		submitting = true;

		try {
			const res = await fetch("/api/account/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, password }),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message ?? "Login failed");
			}

			const data = await res.json();
			setAuth(data);

			const redirect = page.url.searchParams.get("redirect") || "/";
			goto(redirect);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Login failed");
		} finally {
			submitting = false;
		}
	}
</script>

<div class="min-h-full flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="text-center mb-8">
			<h1 class="text-2xl font-bold tracking-tight">BGS Admin</h1>
			<p class="text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
		</div>

		<form
			onsubmit={handleSubmit}
			class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm space-y-4"
		>
			<div>
				<label for="email" class="block text-sm font-medium mb-1.5">Email</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					required
					autocomplete="email"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium mb-1.5">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
			>
				{submitting ? "Signing in..." : "Sign in"}
			</button>
		</form>
	</div>
</div>
