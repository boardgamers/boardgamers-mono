import { useSession } from "./useSession";

export function useRootLayout(_fetch: typeof fetch): void {
  const session = useSession();

  session.fetch = _fetch;
  session.composition = session.composition ?? {};
  session.ssr = session.ssr ?? false;
}
