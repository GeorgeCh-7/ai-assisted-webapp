# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project: Full-stack hackathon app. Two days. Working demo > production code.

## Before You Write Code

1. Read `docs/product.md` — what we're building and why.
2. Read `docs/tech.md` — stack, conventions, recipes.
3. If a decision isn't covered in either doc, **ask** — do not invent conventions.

## Stack (Non-Negotiable)

- Backend: .NET 9 **Minimal API**. No controllers. No MVC.
- ORM: **EF Core 9** with `AppDbContext`. No Dapper. No repositories.
- DB: PostgreSQL 16 via Docker.
- Frontend: **React 18 + TypeScript + Vite**. No Next.js. No Remix.
- Styling: **TailwindCSS + shadcn/ui**. No CSS-in-JS, no CSS Modules, no styled-components.
- Server state: **TanStack Query**. No Redux, no Zustand, no SWR.
- Forms: controlled `useState` for simple, **react-hook-form + zod** for complex.
- Password hashing: **`Konscious.Security.Cryptography.Argon2`** (Argon2id). Registered as custom `IPasswordHasher<AppUser>` after `AddIdentityCore` — last registration wins over Identity's BCrypt default.

## Commands

- Run everything: `docker compose up --build`
- Restart API only: `docker compose restart api`
- Nuke DB: `docker compose down -v && docker compose up --build`
- Add shadcn component: `cd web && npx shadcn@latest add <name>` — do **not** hand-write shadcn components.
- Feature specs live in `docs/features/`. Use `docs/features/_TEMPLATE.md` as the base structure for new ones.

## Service URLs (dev)

| Service  | URL                           |
|----------|-------------------------------|
| Web      | http://localhost:5173         |
| API      | http://localhost:5080         |
| Swagger  | http://localhost:5080/swagger |
| Health   | http://localhost:5080/health  |
| Postgres | localhost:5432 — user `app`, pass `app`, db `appdb` |

Sanity check: `http://localhost:5173` should render API health JSON. If it does, CORS, DB, networking, and hot reload all work.

## Architecture

**Startup flow:** `api/Program.cs` registers services, applies `db.Database.EnsureCreated()` at startup (no migrations), then registers all route groups. Feature endpoint groups are extension methods on `IEndpointRouteBuilder` — register with `app.MapXxxEndpoints()` in `Program.cs`.

**Hot reload:** API runs `dotnet watch` inside the container with source volume-mounted — edit `.cs` files on host, changes pick up automatically. Web uses Vite with `usePolling: true` for the same reason.

**DB schema:** `EnsureCreated()` in `Program.cs` means restarting the API applies schema changes. To force a clean slate, nuke the volume: `docker compose down -v && docker compose up --build`. No migrations exist; add them only if schema churn becomes painful.

**Frontend API calls:** Place fetch logic in `web/src/lib/api.ts` (a typed fetch wrapper using `VITE_API_URL`). TanStack Query hooks in `features/<name>/use<Feature>.ts` call into `api.ts`. Types matching backend DTOs live in `features/<name>/types.ts`.

## Folder Conventions

- Backend features: `api/Features/<FeatureName>/` with `*Endpoints.cs`, `*Dto.cs`, optional `*Mapper.cs`.
- Domain entities (plain POCOs): `api/Domain/<Name>.cs`. Add `DbSet<T>` to `api/Data/AppDbContext.cs`.
- Frontend features: `web/src/features/<feature-name>/` — components, hooks, and types colocated.
- shadcn components: `web/src/components/ui/` — **never edit manually**, always install via CLI.
- Cross-feature hooks: `web/src/hooks/`.

## Rules

- **Never return EF entities directly from endpoints.** Always map to a DTO.
- **Never use `async void`.** Always `async Task`.
- **Never hand-roll a shadcn component.** Install it with the CLI.
- **Never add a library without justifying it in chat first.** Dependencies have cost.
- **Never add auth, tests, CI, migrations, or observability** unless explicitly asked.
- **Never use `any` in TypeScript.** Use `unknown` and narrow, or define a proper type.
- **Never use `localStorage` or `sessionStorage` in artifacts.** Use React state.
- **Prefer `Results.Ok(...)` / `Results.NotFound()` over raw return types** in endpoints.
- **Keep endpoint handlers thin.** If logic is more than ~15 lines, extract to a service class in the same feature folder.

## Style

- C#: file-scoped namespaces, `var` where type is obvious, target-typed `new()`, expression-bodied members where clearer.
- TypeScript: `type` over `interface` for data shapes, `const` arrow functions for components, destructure props in signature.
- API routes: kebab-case, plural nouns → `/api/user-profiles`.
- No comments explaining **what** the code does. Only comments for **why** when non-obvious.

## When Suggesting Changes

- Show the **minimum diff** to achieve the goal. Don't rewrite surrounding code.
- If you need to touch multiple files, list them upfront before editing.
- If you detect a genuine problem outside the requested change, mention it once — don't refactor.

## When Stuck

- If a requirement is ambiguous, ask **one clarifying question** and wait.
- If a library choice isn't in `tech.md`, ask before installing.
- If you can't make the approach in `tech.md` work, say so explicitly — don't silently switch patterns.

## Agent Team Protocols

When spawning agent teams (via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`):

**Loop guardrails:** Every teammate has `MAX_ITERATIONS=8`. Before each retry, reflect: what failed, what would fix it, am I repeating a failed approach? If repeating, escalate to lead.

**Reviewer teammate (3+ builders):** Spawn a dedicated `@reviewer` — read-only, tools limited to lint/test/type-check/security scan. Triggered when any builder marks complete. Lead consumes only reviewer-approved output.

## What We're Optimizing For

1. Working end-to-end flow by end of Day 1.
2. Visual polish before Day 2 demo.
3. Code that the dev can debug at 2am without reading framework docs.

Not optimizing for: test coverage, clean architecture, future extensibility, proper auth, or production readiness.
