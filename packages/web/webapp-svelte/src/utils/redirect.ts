import type { Page } from "@sveltejs/kit";

export function redirectLogin(page: Page): { redirect: string } {
  return {
    redirect: "/login?redirect=" + page.path + (page.query.toString() === "" ? "" : "?" + page.query.toString()),
  };
}
