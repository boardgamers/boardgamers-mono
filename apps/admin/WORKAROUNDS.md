# Workarounds & future cleanups — `apps/admin`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Svelte eslint rules disabled codebase-wide (`eslint.config.js`)

`svelte/require-each-key`, `svelte/no-navigation-without-resolve`, `svelte/prefer-writable-derived`, `svelte/no-at-html-tags` are turned off because the admin app predates them (web satisfies them — see how `apps/web` uses `resolve()` for every `goto`/`href`). Until the plugin deps were added the admin eslint config didn't even load, so the violations accumulated unnoticed. Fix forward: enable one rule at a time and clean up its call sites.
