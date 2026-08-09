import type { PageServerLoad } from "./$types";
import { loadBoardgameCard } from "@/lib/thumbnail-data.server";

export const load: PageServerLoad = ({ params }) => loadBoardgameCard(params.boardgameId);
