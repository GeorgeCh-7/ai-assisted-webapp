# Claude Code Instructions

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

## Folder Conventions

Follow `docs/tech.md` exactly. Specifically:

- Backend features go in `api/Features/<FeatureName>/` with `*Endpoints.cs`, `*Dto.cs`.
- Frontend features go in `web/src/features/<feature-name>/` with components, hooks, and types colocated.
- shadcn components live in `web/src/components/ui/` and are **never edited manually**.

## Commands

- Feature specs live in `docs/features/`. Use `docs/features/_TEMPLATE.md` as the base structure for new ones.
- Run everything: `docker compose up --build`
- Restart API only: `docker compose restart api`
- Add shadcn component: `cd web && npx shadcn@latest add <name>` — do **not** hand-write shadcn components.
- Nuke DB: `docker compose down -v && docker compose up --build`

## Rules

- **Never return EF entities directly from endpoints.** Always map to a DTO.
- **Never use `async void`.** Always `async Task`.
- **Never hand-roll a shadcn component.** Install it with the CLI.
- **Never add a library without justifying it in chat first.** Dependencies have cost.
- **Never add auth, tests, CI, migrations, or observability** unless explicitly asked. We're shipping a demo.
- **Never use `any` in TypeScript.** Use `unknown` and narrow, or define a proper type.
- **Never use `localStorage` or `sessionStorage` in artifacts.** Use React state.
- **Prefer `Results.Ok(...)` / `Results.NotFound()` over raw return types** in endpoints — gives proper OpenAPI schema.
- **Keep endpoint handlers thin.** If logic is more than ~15 lines, extract to a service class in the same feature folder.

## Style

- C#: file-scoped namespaces, `var` where type is obvious, target-typed `new()`, expression-bodied members where clearer.
- TypeScript: `type` over `interface` for data shapes, `const` arrow functions for components, destructure props in signature.
- No comments explaining **what** the code does. Only comments for **why** when non-obvious.
- No emoji in code. No decorative banners in comments.

## When Suggesting Changes

- Show the **minimum diff** to achieve the goal. Don't rewrite surrounding code.
- If you need to touch multiple files, list them upfront before editing.
- If you detect a genuine problem outside the requested change (not a nit), mention it once — don't go on a refactor tour.

## When Stuck

- If a requirement is ambiguous, ask **one clarifying question** and wait. Don't guess and build.
- If a library choice isn't in `tech.md`, ask before installing.
- If you can't make the approach in `tech.md` work, say so explicitly — don't silently switch patterns.

## Agent Team Protocols

When spawning agent teams (via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), apply these rules:

### Loop Guardrails

- Every teammate has a hard `MAX_ITERATIONS=8` per task. If not done by iteration 8, stop and report.
- Before each retry on a failing task, force a reflection step answering:
  - What specifically failed?
  - What concrete change would fix it?
  - Am I repeating an approach that already didn't work?
- If the reflection shows repetition, escalate to the lead instead of retrying.

### Dedicated Reviewer Teammate

For teams with 3+ builder teammates, spawn a dedicated `@reviewer`:

- **Read-only.** No write access to code.
- **Tools limited to:** lint, test, type-check, security scan.
- **Triggered automatically** when any builder marks a task complete.
- **Ratio:** 1 reviewer per 3–4 builders.
- **Lead consumes only reviewer-approved output.** If the reviewer flags issues, the builder retries before the lead synthesizes.

## What We're Optimizing For

1. Working end-to-end flow by end of Day 1.
2. Visual polish before Day 2 demo.
3. Code that the dev can debug at 2am without reading framework docs.

Not optimizing for: test coverage, clean architecture, future extensibility, proper auth, or production readiness.
