# Workarounds

## OG share images render on demand (no persistent cache yet)

`/share.webp/<kind>/…` screenshots the matching `/thumbnail/<kind>/…` card with
Playwright (PNG) and converts to WebP via sharp, on a cache miss, guarded by a one-slot
render queue. Responses carry a content-derived **ETag** (a hash of the exact db fields
the card renders) plus `Cache-Control: public, max-age=300, must-revalidate`, so
clients/CDNs revalidate cheaply (`If-None-Match` → 304, no render) and a changed entity
(player joined, round advanced, karma changed) automatically yields a new ETag and a
fresh render.

Once S3 (or any blob storage) is available, cache rendered images there keyed by
`route+etag` (the ETag already captures data changes), serve the cached object when
present, and only render on a miss — renders are ~1s of Chromium each. Consider a
CDN/stale-while-revalidate in front as well.
