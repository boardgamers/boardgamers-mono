<script lang="ts">
	import { Container } from "@/modules/cdk";
</script>

<Container class="mx-auto max-w-xl px-4 py-6 sm:py-10">
	<div
		class="rounded-lg border border-gray-200 bg-white px-5 pb-6 pt-8 text-center shadow-md dark:border-gray-700 dark:bg-gray-800 sm:px-8"
	>
		<div
			class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
			aria-hidden="true"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1.75rem" height="1.75rem" fill="currentColor">
				<path
					d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
				/>
			</svg>
		</div>
		<h1 class="mt-4 text-2xl font-bold">Authorization error</h1>
		<p class="mt-2 text-sm">The sign-in request from this application is invalid or could not be verified.</p>
		<p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
			This usually means the application is misconfigured. Nothing was authorized — you can close this page.
		</p>
	</div>
</Container>
