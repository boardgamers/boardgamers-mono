import type { Page } from "@sveltejs/kit";

export function redirectLoggedIn(page: Page): string {
  return "/login?redirect=" + page.path + (page.query.toString() === "" ? "" : "?" + page.query.toString());
}

export function redirectLoggedOut(page: Page): string {
  return page.query.get("redirect") ?? "/";
}
