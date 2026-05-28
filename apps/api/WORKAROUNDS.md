# Workarounds & future cleanups — `apps/api`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Migration-order CI guard supports the old layout (`scripts/check-migrations.ts`)

`check-migrations.ts` reads the base branch's migration registry across **both** the old single-file (`migrations.ts`) and new per-version (`migrations/`) layouts, because the refactor straddles that change. Once the new layout is on `master`, the old-layout fallback (`baseSource()`'s second candidate path) can be dropped.
