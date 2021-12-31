export function redirectLoggedIn(url: URL): string {
  return "/login?redirect=" + url.href;
}

export function redirectLoggedOut(url: URL): string {
  return url.searchParams.get("redirect") ?? "/";
}
