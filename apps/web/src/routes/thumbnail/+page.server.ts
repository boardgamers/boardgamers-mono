import type { PageServerLoad } from "./$types";
import { loadHomeCard } from "@/lib/thumbnail-data.server";

export const load: PageServerLoad = () => loadHomeCard();
