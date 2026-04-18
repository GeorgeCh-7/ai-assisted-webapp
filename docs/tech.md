# Tech Reference

The stack, conventions, and recipes. Read this before adding anything.

---

## Stack

| Layer        | Choice                          | Why                                       |
|--------------|---------------------------------|-------------------------------------------|
| Backend      | .NET 9 Minimal API              | Low ceremony, fast iteration              |
| ORM          | EF Core 9 + Npgsql              | Scaffolding speed; switch to Dapper if perf matters |
| DB           | PostgreSQL 16                   | Dockerizable, no licensing noise          |
| Real-time    | ASP.NET Core SignalR            | First-class .NET WebSocket hub; handles reconnect, groups, presence |
| Logging      | Serilog                         | Structured logs; SignalR connection ID enriched on every entry |
| Testing      | xUnit + WebApplicationFactory   | Unit tests for business logic; integration tests for API endpoints |
| XMPP         | XmppDotNet (Phase 3)            | .NET XMPP library for Jabber client + federation |
| Frontend     | React 18 + TypeScript + Vite    | Dense, low-boilerplate, agent-friendly    |
| Styling      | TailwindCSS + shadcn/ui         | Copy-paste components, no lock-in         |
| Server state | TanStack Query                  | Standard; handles caching, refetch, errors |
| Local state  | useState / useReducer           | No Redux unless truly needed              |
| Container    | Docker Compose (dev)            | One-command startup                       |

---

## Folder Conventions

### Backend (`api/`)

```
api/
├── Program.cs                 # Route registration + startup wiring
├── Api.csproj
├── appsettings.json
├── Dockerfile
├── Data/
│   └── AppDbContext.cs        # DbSets live here
├── Domain/                    # Entities (plain POCOs)
│   └── Item.cs
└── Features/                  # One folder per feature
    └── Items/
        ├── ItemsEndpoints.cs  # MapGroup + route handlers
        ├── ItemDto.cs         # Request/response shapes
        └── ItemMapper.cs      # Entity ↔ DTO (if needed)
```

**Rules:**

- **One feature = one folder** under `Features/`. Everything for that feature lives together.
- **Endpoints go in `*Endpoints.cs`** as static classes with extension methods on `IEndpointRouteBuilder`.
- **DTOs separate from entities.** Never return `DbContext` entities directly.
- **No controllers, no MVC.** Minimal API only.
- **No repositories.** `AppDbContext` is the repository. EF Core handles abstraction.
- **No MediatR, no CQRS.** Keep it flat until it hurts.

### Frontend (`web/src/`)

```
web/src/
├── main.tsx                   # Entry + providers
├── App.tsx                    # Router root
├── index.css                  # Tailwind + theme tokens
├── lib/
│   ├── utils.ts               # cn() helper
│   └── api.ts                 # fetch wrapper + API base URL
├── components/
│   ├── ui/                    # shadcn components (don't edit)
│   └── <feature>/             # app-specific components
├── features/                  # One folder per feature
│   └── items/
│       ├── ItemsPage.tsx
│       ├── ItemForm.tsx
│       ├── useItems.ts        # TanStack Query hooks
│       └── types.ts           # TS types matching backend DTOs
└── hooks/                     # Cross-feature hooks
```

**Rules:**

- **Colocation > global folders.** A feature's components, hooks, and types live in `features/<name>/`.
- **shadcn components stay in `components/ui/`** and are never edited by hand. Use `npx shadcn add` for new ones.
- **No page-level CSS files.** Tailwind classes only, with extracted components for repeated patterns.
- **Types for API responses live next to the hook that fetches them**, not in a global types folder.

---

## Naming

- **C# files / classes:** `PascalCase.cs` → `ItemsEndpoints.cs`, `class ItemDto`
- **TS files:** `PascalCase.tsx` for components, `camelCase.ts` for hooks/utils → `ItemForm.tsx`, `useItems.ts`
- **Folders:** lowercase → `features/items/`, not `Features/Items/`
- **API routes:** kebab-case, plural nouns → `/api/user-profiles`, not `/api/UserProfile`
- **DB tables:** EF Core default (PascalCase) — don't fight it
- **Env vars:** `SCREAMING_SNAKE_CASE`

---

## Recipes

### Add a new entity

1. Create `api/Domain/<Name>.cs`:

   ```csharp
   namespace Api.Domain;

   public class Item
   {
       public Guid Id { get; set; }
       public string Name { get; set; } = "";
       public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
   }
   ```

2. Add `DbSet` to `AppDbContext`:

   ```csharp
   public DbSet<Item> Items => Set<Item>();
   ```

3. Restart API. `EnsureCreated()` applies the schema.

### Add a new endpoint group

1. Create `api/Features/Items/ItemsEndpoints.cs`:

   ```csharp
   using Api.Data;
   using Api.Domain;
   using Microsoft.EntityFrameworkCore;

   namespace Api.Features.Items;

   public static class ItemsEndpoints
   {
       public static IEndpointRouteBuilder MapItemsEndpoints(this IEndpointRouteBuilder app)
       {
           var group = app.MapGroup("/api/items").WithTags("Items");

           group.MapGet("/", async (AppDbContext db) =>
               await db.Items.ToListAsync());

           group.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
               await db.Items.FindAsync(id) is { } item
                   ? Results.Ok(item)
                   : Results.NotFound());

           group.MapPost("/", async (Item item, AppDbContext db) =>
           {
               db.Items.Add(item);
               await db.SaveChangesAsync();
               return Results.Created($"/api/items/{item.Id}", item);
           });

           return app;
       }
   }
   ```

2. Wire it in `Program.cs`:

   ```csharp
   app.MapItemsEndpoints();
   ```

### Add a TanStack Query hook

`web/src/features/items/useItems.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type Item = {
  id: string
  name: string
  createdAt: string
}

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: () => api.get<Item[]>('/api/items'),
  })
}

export function useCreateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: Partial<Item>) => api.post<Item>('/api/items', item),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}
```

### Add a shadcn component

```bash
cd web
npx shadcn@latest add <component-name>
```

Import from `@/components/ui/<component-name>`.

---

## Cross-Cutting

### CORS

Open to any origin in dev. Configured in `Program.cs`. Do not tighten until demo day — don't want to debug CORS at hour 30.

### Auth

**Not implemented.** If needed:
- Dev-only: pass a `X-User-Id` header, parse in middleware, attach to `HttpContext.Items`.
- Real: JWT via `Microsoft.AspNetCore.Authentication.JwtBearer`.
- Do not add until the app's domain model is settled.

### Validation

- Backend: DataAnnotations on DTOs (`[Required]`, `[MaxLength]`). Minimal API validates if you use `[FromBody]` binding with `Microsoft.AspNetCore.Http.Validation` — or just check manually in the handler for speed.
- Frontend: react-hook-form + zod if forms get complex. For simple forms, controlled `useState` is fine.

### Error handling

- Backend: `Results.BadRequest(new { error = "..." })` for expected errors; let exceptions throw for bugs.
- Frontend: TanStack Query exposes `error` per query; render inline.
- Do not build a global error boundary/logger unless needed for demo polish.

### Logging

- Backend: `ILogger<T>` injected into endpoint handlers. `_logger.LogInformation("...")`.
- Frontend: `console.log` is fine for a hackathon. Remove before demo if judges open DevTools.

---

## What to Skip (Until Needed)

- Migrations (use `EnsureCreated()` until schema churn hurts)
- Real auth
- Automated tests
- Production Dockerfiles
- CI/CD
- Rate limiting, caching, background jobs
- Observability (metrics, tracing)
- Docker secrets / vault integration

Every item on this list is a time trap disguised as "good practice." Add them only when absent functionality blocks a demo goal.

---

## SignalR

Hub class lives in `api/Hubs/ChatHub.cs`. Register in `Program.cs`:

```csharp
builder.Services.AddSignalR();
app.MapHub<ChatHub>("/hubs/chat");
```

Frontend client:

```bash
cd web && npm install @microsoft/signalr
```

Groups map to rooms: `Groups.AddToGroupAsync(connectionId, roomId)`. Personal dialogs use a deterministic group name: `$"dm-{Math.Min(userA, userB)}-{Math.Max(userA, userB)}"`.

---

## Serilog + Connection ID Enrichment

```csharp
builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("App", "ChatApi")
    .WriteTo.Console(new RenderedCompactJsonFormatter()));
```

In `ChatHub`, push connection ID into the log context on every invocation:

```csharp
using (LogContext.PushProperty("SignalRConnectionId", Context.ConnectionId))
{
    // handler body
}
```

---

## Idempotency & Retries

**Pattern:** client generates a `Guid messageId` before sending. Server checks if a row with that ID already exists; if so, returns the existing record without inserting. Frontend never generates a new ID on retry — same ID, same send.

```csharp
// in message handler
if (await db.Messages.AnyAsync(m => m.Id == dto.MessageId)) return;
```

Frontend: TanStack Query mutations set `retry: 3`. SignalR `onreconnected` callback re-sends any pending messages using their original IDs.

---

## Testing

Add test project:

```bash
dotnet new xunit -n Api.Tests
dotnet add Api.Tests reference api/Api.csproj
dotnet add Api.Tests package Microsoft.AspNetCore.Mvc.Testing
```

`WebApplicationFactory<Program>` spins up the full app in-process for endpoint tests. Business logic (e.g., ban rules, friend-request state machine) is unit-tested by calling service methods directly with an in-memory EF context (`UseInMemoryDatabase`).
