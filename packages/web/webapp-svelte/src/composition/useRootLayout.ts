import { useSession } from "./useSession";

export function useRootLayout(_fetch: typeof fetch): void {
  const session = useSession();

  session.fetch = _fetch;
  session.ssr = session.ssr ?? false;
}
