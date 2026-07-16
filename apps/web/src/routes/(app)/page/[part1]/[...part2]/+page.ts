import type { PageLoad } from "./$types";
import { get, setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const parts = [params.part1, params.part2].filter(Boolean);
  const pageContent = await get(`/page/${parts.join(":")}`);
  return { pageContent };
};
