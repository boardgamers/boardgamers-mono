import type { HandleClientError } from "@sveltejs/kit";
import { reportError } from "@/lib/report-error.svelte";

// Report SvelteKit load/render errors (which bypass window.onerror) to the backend.
export const handleError: HandleClientError = ({ error }) => {
  reportError(error);
};
