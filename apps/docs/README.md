# boardgamers-docs

Self-hosted docs for the boardgamers ecosystem — served at
[docs.boardgamers.space](https://docs.boardgamers.space) (content in
[`docs/`](./docs), check us out at [boardgamers.space](https://boardgamers.space)!).

A single dependency-free-ish Node server (`server.ts`, Node ≥ 24 type-stripping — no
build step) renders the markdown pages to HTML with navigation, and serves the **raw
markdown** to agents:

- `Accept: text/markdown` (or any accept header where markdown outranks HTML — a
  non-browser `Accept: */*` counts) → raw markdown
- `<page>.md` suffix or `?format=md` → raw markdown, always
- `/llms.txt` → machine-readable index of every page as a markdown link

```bash
curl -H "Accept: text/markdown" http://localhost:8620/guide/architecture
curl http://localhost:8620/guide/architecture.md
```

## Development

```bash
pnpm install
pnpm dev        # node --watch server.ts → http://localhost:8620
pnpm test       # node:test suite (negotiation, rendering, routes)
pnpm build      # type-check (tsc --noEmit)
```

Pages live in `docs/`; `README.md` is its directory's index page, other `*.md` files
are slugged (`My Page.md` → `/my-page`). Frontmatter is stripped; `title:` overrides
the first `# heading` as the page title.
