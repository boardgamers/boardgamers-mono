<script lang="ts" module>
	import { ApiError } from "@/lib/api";

	// Feedback/game requests are posted on the forum AS the user (#340), so they
	// need a linked forum account. When the API reports forum_account_required, the
	// gate prompts to link it (BGS OAuth on the forum) instead of showing a bare error.
	//
	// The forum's SSO initiate URL (nodebb-plugin-sso-oauth2-multiple strategy
	// "boardgamers") starts BGS OAuth; the forum account is auto-created+linked on first
	// login. The plugin doesn't forward a return URL into the OAuth state, so the draft
	// is stashed in sessionStorage and restored on return instead.
	const FORUM_AUTH_URL = "https://forum.boardgamers.space/auth/boardgamers";

	export interface ForumLinkGate {
		/** True when the error is the API's forum-account gate (and shows the prompt). */
		handle: (err: unknown) => boolean;
		/** Save the current draft before redirecting to the forum SSO. */
		stashDraft: (draft: Record<string, string>) => void;
	}
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import { Button } from "@/modules/cdk";

	let {
		draftKey,
		onrestore,
	}: {
		// Per form: the draft survives the OAuth round-trip and must not leak across
		// forms — /feedback's site + game-request forms and each boardgame page get
		// their own key.
		draftKey: string;
		// Called on mount with the stashed draft when returning from the linking flow.
		onrestore: (draft: Record<string, string>) => void;
	} = $props();

	let needed = $state(false);

	export function handle(err: unknown): boolean {
		if (err instanceof ApiError && err.code === "forum_account_required") {
			needed = true;
			return true;
		}
		return false;
	}

	export function stashDraft(draft: Record<string, string>) {
		sessionStorage.setItem(draftKey, JSON.stringify(draft));
	}

	onMount(() => {
		// Returning from the forum linking flow: hand the draft back so the user can
		// re-submit (their forum account now exists, so the create succeeds).
		const draft = sessionStorage.getItem(draftKey);
		if (draft) {
			sessionStorage.removeItem(draftKey);
			try {
				onrestore(JSON.parse(draft) as Record<string, string>);
			} catch {
				// Corrupt draft — ignore.
			}
		}
	});

	function linkForumAccount() {
		window.location.href = FORUM_AUTH_URL;
	}
</script>

{#if needed}
	<div
		class="mt-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
		role="alert"
	>
		<p>
			Requests are discussed on our forum, so they need a linked forum account. Link yours (it uses your Boardgamers
			login) to submit — your draft is saved.
		</p>
		<Button color="primary" class="mt-2" onclick={linkForumAccount}>Link your forum account</Button>
	</div>
{/if}
