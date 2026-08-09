import type { PageServerLoad } from "./$types";
import { loadGameCard } from "@/lib/thumbnail-data.server";

export const load: PageServerLoad = ({ params }) => loadGameCard(params.gameId);
