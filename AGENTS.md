# AGENTS.md

Guidance for AI agents (and humans) working in this monorepo.

## What this is

Boardgamers — an online board game platform. pnpm workspace, Node ≥ 24, ESM (`"type": "module"`).

| Path               | What                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `apps/web`         | Player frontend (SvelteKit, **pinned to an ancient prerelease** — see `apps/web/WORKAROUNDS.md`) |
| `apps/admin`       | Admin panel (SvelteKit, modern)                                                                  |
| `apps/api`         | REST API (Koa + MongoDB)                                                                         |
| `apps/game-server` | Game engine runner / gameplay API                                                                |
| `apps/docs`        | Docs site                                                                                        |
| `packages/models`  | Shared Zod schemas + Mongo collection definitions (`@bgs/models`)                                |
| `packages/utils`   | Shared helpers (`@bgs/utils`)                                                                    |

## Comments

Default to no comment — write self-explanatory code. Only comment the non-obvious: a _why_ (decision, constraint, gotcha), or a workaround for an external bug (link the issue/PR).

## Conventions

- **Formatting** is enforced (see `.prettierrc`: 120 cols, 2-space, `trailingComma: es5`). Don't hand-format; let the formatter run.
- **Document shapes live in `@bgs/models`** as Zod schemas. They define the types with `z.infer` and are also inserted in DB as validation schemas (`"warn"`).
- **Tests** are colocated `*.spec.ts` using `node:test` (api/game-server). API tests run with `NODE_ENV=test` against a `…-test` database. Build fixtures inline via `app/config/test-helpers.ts` rather than relying on shared seed data.
