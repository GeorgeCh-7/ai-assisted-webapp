# Hackathon Skeleton

Minimal full-stack skeleton designed for rapid hackathon iteration.

**Stack:** .NET 9 Minimal API · EF Core · PostgreSQL 16 · React 18 + TypeScript · Vite · TailwindCSS + shadcn/ui

---

## Quick Start

```bash
docker compose up --build
```

That's it. First build takes ~2 minutes (NuGet restore + npm install). Subsequent starts are ~10 seconds.

### URLs

| Service  | URL                                | Notes                          |
|----------|------------------------------------|--------------------------------|
| Web      | http://localhost:5173              | Vite dev server (hot reload)   |
| API      | http://localhost:5080              | Redirects `/` → `/swagger`     |
| Swagger  | http://localhost:5080/swagger      | API explorer                   |
| Health   | http://localhost:5080/health       | Sanity check                   |
| Postgres | localhost:5432                     | user `app`, pass `app`, db `appdb` |

**Sanity check:** open http://localhost:5173 — you should see the API health JSON rendered on the page. If yes, end-to-end wiring works (CORS, DB, networking, hot reload all confirmed).

---

## Development

Hot reload is wired on both sides:

- **API** — `dotnet watch` in the container, source volume-mounted. Edit `.cs` files on host, changes pick up automatically.
- **Web** — Vite dev server with polling enabled (works across Docker volume mounts on any host).

### Adding a shadcn component

```bash
cd web
npx shadcn@latest add button
npx shadcn@latest add input card
```

Components land in `web/src/components/ui/`.

### Adding a DB entity

1. Create an entity class (e.g. `api/Domain/Item.cs`)
2. Add a `DbSet<Item>` to `api/Data/AppDbContext.cs`
3. Restart the API (`docker compose restart api`) — `EnsureCreated()` applies the schema

> For real migrations, switch `EnsureCreated()` → `Migrate()` in `Program.cs` and use `dotnet ef migrations add <Name>`.

### Adding an endpoint

In `api/Program.cs`:

```csharp
app.MapGet("/api/items", async (AppDbContext db) =>
    await db.Items.ToListAsync());

app.MapPost("/api/items", async (Item item, AppDbContext db) =>
{
    db.Items.Add(item);
    await db.SaveChangesAsync();
    return Results.Created($"/api/items/{item.Id}", item);
});
```

For larger feature sets, extract to `api/Features/Items/ItemsEndpoints.cs` and expose via an extension method.

---

## Project Layout

```
.
├── docker-compose.yml
├── api/
│   ├── Api.csproj
│   ├── Program.cs              # All routes + startup
│   ├── appsettings.json
│   ├── Dockerfile
│   └── Data/
│       └── AppDbContext.cs     # Add DbSets here
└── web/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── components.json         # shadcn config
    ├── Dockerfile
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css           # Tailwind + theme tokens
        ├── lib/utils.ts        # cn() helper
        └── components/ui/      # (created by `shadcn add`)
```

---

## Hackathon Workflow Notes

**Before writing any feature code:**

1. Write `docs/product.md` — mission, users, success criteria (5 min)
2. Write `docs/tech.md` — stack decisions, constraints, what's out of scope (already mostly captured here)
3. Have Opus generate `docs/design.md` + `docs/todo.md` from (1) and (2)
4. Review decisions before spawning any agent team

**When to use agent teams (experimental Claude Code feature):**

- Feature has 3+ genuinely parallel tracks (e.g. backend API + frontend UI + tests)
- Feature spans 100–300 lines per track
- You've already written a plan — teams don't replace planning

**When to use a single agent:**

- Small features, polish, bugfixes
- Tightly coupled changes
- Anything exploratory

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Port already in use | `docker compose down` then retry; or change ports in `docker-compose.yml` |
| Hot reload not firing (API) | Ensure `DOTNET_USE_POLLING_FILE_WATCHER=1` is set (it is in compose) |
| Hot reload not firing (web) | `usePolling: true` is set in `vite.config.ts`; if still stuck, restart the `web` container |
| DB schema out of date | `docker compose down -v` nukes the volume; next `up` recreates from scratch |
| CORS blocked in browser | API allows any origin in dev; verify via Swagger first |

---

## What's Intentionally Missing

To keep this lean for a 2-day hackathon:

- **No auth** — add JWT or a dev bypass header only when needed
- **No real migrations** — `EnsureCreated()` is fine; switch to `Migrate()` if schema churn bites
- **No tests** — add them selectively; hackathons reward working demos over coverage
- **No production Dockerfiles** — dev-only containers; ship-ready builds are a Day 3 concern
