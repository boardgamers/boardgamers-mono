# Frontend workarounds

This app is pinned to an **ancient prerelease of SvelteKit** (`@sveltejs/kit@1.0.0-next.216`, Svelte 3, `@sveltejs/adapter-node@1.0.0-next.58`) that predates a number of changes in modern Node (18/20/24) and the Fetch/Response specs. A full migration to a current SvelteKit is planned but deliberately deferred — it's several large, coupled changes (routing, `load` signature, hooks API, adapters, Svelte 4/5).

In the meantime we carry a few targeted, reversible workarounds so the app keeps running on modern Node. **All of them can — and should — be deleted once the SvelteKit migration lands.** Each workaround in the code links back to this file.

> If you hit a new SSR-only crash on a modern Node version, it is almost certainly the same family of bug. Prefer a small, documented patch here over starting the migration ad-hoc.

---

## 1. SSR `fetch` reconstruction throws on null-body statuses

**File:** `src/hooks.ts` — `normalizeNullBodyStatus()` / `externalFetch`

**Symptom**

```
500
Response constructor: Response body is given with a null body status.

initial_fetch@.../.svelte-kit/dev/runtime/internal/start.js:441
fetch@.../.svelte-kit/dev/runtime/internal/start.js
get@/src/composition/useRest.ts
```

**Cause**

During SSR, this version of SvelteKit serializes every `fetch` it makes into a
`<script data-type="svelte-data">` payload (`{ status, statusText, headers, body }`),
then rehydrates it on the client with:

```js
return Promise.resolve(new Response(body, init)); // start.js
```

The Fetch spec defines **null body statuses** — `101, 103, 204, 205, 304` — that
must not carry a body. Modern browsers and Node now enforce this, so
`new Response(<body>, { status: 204 | 304 | ... })` throws. The 2021 SvelteKit
runtime predates that enforcement. In dev the most common trigger is a **304 Not
Modified** on a proxied `/api` request, or an endpoint that responds **204 No
Content** (e.g. `/site/announcement` with no announcement set).

**Workaround**

`externalFetch` (the supported hook every SSR external request passes through)
normalizes any null-body status into a plain body-less `200` before SvelteKit
serializes it, so the rehydrated `new Response` stays spec-legal. This is
transparent to callers: `useRest`'s `getResponseData` only branches on
`status >= 400`, and a 204/304 has no body to read anyway.

**Remove when:** SvelteKit is upgraded — modern versions serialize SSR fetches
correctly and never reconstruct a body-less status with a body.

---

## 2. SSR POST to `/account/confirm` breaks on Node 20+

**File:** `src/routes/confirm.svelte` — the `typeof window === "undefined"` guard

**Cause**

The email-confirmation page runs a `POST /account/confirm` inside its `load`.
The same ancient SSR `fetch` shim (see #1) breaks on this request on Node 20+.

**Workaround**

During SSR (`typeof window === "undefined"`) we skip the request and return a
plain `200`, deferring the actual confirmation to the **client-side** `load`
run. Functionally the confirmation still happens; it just doesn't run on the
server.

**Remove when:** SvelteKit is upgraded — the confirmation `POST` can then run in
`load` normally (server or client).

---

## 3. SSR HTML mangles multiline attribute values

**File:** `src/hooks.ts` — the `handle` hook

**Cause**

This version of SvelteKit escapes newlines inside HTML attribute values when
serializing the rendered page, turning real newlines in our `<meta
name="description">` content into literal `\n`.

**Workaround**

The `handle` hook post-processes the rendered HTML and restores real newlines
inside the `<meta name="description">` tag.

**Remove when:** SvelteKit is upgraded — current versions serialize multiline
attributes correctly.

---

## Migration checklist (when we finally do it)

When upgrading SvelteKit, grep for `WORKAROUNDS.md` across the repo and remove
each referenced hack, verifying the underlying bug is gone:

- [ ] #1 — drop `normalizeNullBodyStatus`; confirm SSR `fetch` of a 204/304 endpoint (e.g. `/site/announcement` with no announcement) renders without a 500.
- [ ] #2 — drop the SSR guard in `confirm.svelte`; confirm the confirmation `POST` runs in `load`.
- [ ] #3 — drop the `<meta name="description">` fix-up in `handle`; confirm the description renders with correct newlines.
