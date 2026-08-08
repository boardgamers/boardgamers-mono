# Workarounds

## OG share images render on demand (no persistent cache yet)

`/og/share.png` screenshots the `/og` card with Playwright on every unique request
(query string), guarded only by a one-slot render queue and
`Cache-Control: public, max-age=86400` on the response.

Once S3 (or any blob storage) is available, cache rendered PNGs there keyed by
`title+subtitle+game+players`, serve the cached object when present, and only render
on a miss — renders are ~1s of Chromium each and cards for the same page are
identical. Consider a CDN/stale-while-revalidate in front as well.
