# Feature Spec: [Name]

> Template for per-feature specs. Copy this file as `phase-N-spec.md` and fill in.
> Keep it to one page. If it doesn't fit on one page, the feature is too big — split it.

---

## Goal

One sentence describing what this feature delivers.

## User-visible Outcome

What works after this feature ships? Describe it from the user's perspective, not the code's.

Example: "A user can open the homepage, see a list of their items, and create a new one via a form."

## Context

- Which roadmap phase is this? (link to `roadmap.md`)
- What does it depend on? (previous features, external APIs, etc.)
- What's explicitly out of scope for this feature?

## Files to Create / Modify

Rough list. Exact names can shift during implementation, but the structure should be stable.

**Backend:**
- `api/Domain/<Entity>.cs`
- `api/Data/AppDbContext.cs` (add DbSet)
- `api/Features/<FeatureName>/<FeatureName>Endpoints.cs`
- `api/Features/<FeatureName>/<FeatureName>Dto.cs`

**Frontend:**
- `web/src/features/<feature-name>/<PageName>.tsx`
- `web/src/features/<feature-name>/use<Feature>.ts`
- `web/src/features/<feature-name>/types.ts`
- Possibly: `web/src/App.tsx` (add route)

## Parallel Tracks

If this feature will be built by an agent team, list independent tracks (2–4). If building with a single agent, skip this section.

1. **Backend track** — entity, DbContext, endpoints
2. **Frontend track** — page, hooks, forms
3. **Integration track** — wire frontend to backend, end-to-end smoke

## Implementation Order (single-agent)

If using a single agent, list task groups in dependency order:

1. Define domain entity + add to DbContext
2. Create endpoints (GET list, POST create, GET by id)
3. Create frontend types + TanStack Query hooks
4. Build page component + form
5. Wire route, test end-to-end

## Scorecard

Specific, testable pass/fail criteria. 3–5 items. Be concrete — "works well" is not a criterion.

- [ ] `GET /api/<resource>` returns a list (empty or populated)
- [ ] `POST /api/<resource>` with a valid payload creates a row and returns 201
- [ ] `POST /api/<resource>` with an invalid payload returns 400
- [ ] Frontend page loads at `/<path>` and displays the list
- [ ] Creating an item via the form adds it to the list without a page reload

## Out of Scope

What we are **not** building in this feature, even if it seems related. Prevents scope creep mid-implementation.

- Authentication / authorization
- Editing or deleting items (deferred to Phase N)
- Pagination
- Error boundary handling

## Notes

Anything else the agent should know: libraries to prefer, patterns to avoid, edge cases to handle, design references.
