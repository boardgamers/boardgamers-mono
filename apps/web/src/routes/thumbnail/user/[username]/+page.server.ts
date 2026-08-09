import type { PageServerLoad } from "./$types";
import { loadUserCard } from "@/lib/thumbnail-data.server";

export const load: PageServerLoad = ({ params }) => loadUserCard(params.username);
