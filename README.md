# Newtonite-SE — Internal Operations Management

Foundation milestone (M0): monorepo scaffold proving the vertical slice works end-to-end.

## Repo state

Empty repo at start (`master`, no commits). This milestone adds:

- `backend/` — Node + Express + TypeScript + Prisma (PostgreSQL) + Vitest
  - `GET /api/health` + JSON 404 + central error serializer (`backend/src/app.ts`)
  - Prisma model: `User`, `Team`, `Membership(role)`, `WorkItem(version)`,
    `Comment`, `ActivityEvent` (`backend/prisma/schema.prisma`)
  - Tests: `backend/tests/health.test.ts` (supertest)
- `frontend/` — React + TypeScript + Vite + Vitest
  - `App.tsx` fetches `/api/health` (dev proxied to backend), shows reachable/unreachable states
  - Tests: `frontend/src/App.test.tsx`
- `docker-compose.yml` — local PostgreSQL 16
- Root `package.json` workspaces + `test` / `typecheck` / `build` scripts

Deliberately **not** in M0: auth/login, work-item CRUD, 409 concurrency enforcement,
workflow transitions, comments/activity writes, search/filter/pagination.
Schema already contains `version`, roles, and history tables so M1 needs no rework.

## Prerequisites

- Node.js >= 20, npm >= 10
- Docker (for PostgreSQL)

## Run (local)

```powershell
# 1. env
Copy-Item .env.example .env

# 2. database
docker compose up -d postgres

# 3. install (from repo root)
npm install

# 4. prisma client + migrate
npm run prisma:generate
npm run prisma:migrate

# 5. dev (two terminals)
npm run dev:backend   # :3001
npm run dev:frontend  # :5173, proxies /api -> :3001
```

## Verify

```powershell
npm run typecheck
npm test
```

Expected: backend 2 tests pass, frontend 3 tests pass, `tsc --noEmit` clean both workspaces.
Prisma `validate`/`generate` requires no live DB connection.

## Known limitations (M0)

- No authentication/authorization yet — health endpoint is public by design.
- No work-item API yet; Prisma schema is unapplied until `prisma:migrate` runs.
- Frontend has no routing/state management; single health view only.
- No async workers, notifications, or idempotency keys yet (planned M3+).

---

## M1.1 — Authentication + team authorization (implemented)

### Endpoints

| Method | Path | Auth | Rule |
|---|---|---|---|
| POST | `/api/auth/register` | no | Creates a regular user only. Unknown keys (incl. `isGlobalAdmin`) are rejected with 400; `isGlobalAdmin` is always `false`. Duplicate email → 409 `EMAIL_TAKEN`. |
| POST | `/api/auth/login` | no | `{ email, password }` → `{ token, expiresIn, user }`. Unknown email, missing hash, or wrong password all return 401 `INVALID_CREDENTIALS` (no account enumeration). |
| GET | `/api/auth/me` | Bearer | Returns the token owner's identity + memberships. No user-id parameter exists to spoof. |
| GET | `/api/teams` | Bearer | Own teams (with role). Global admins see all teams (`role: null` = access via global grant). |
| POST | `/api/teams` | Bearer | Global admin only → 201 (creator joins as team ADMIN). Others → 403 `ROLE_REQUIRED`. Duplicate name → 409 `TEAM_NAME_TAKEN`. |
| GET | `/api/teams/:teamId` | Bearer | Member of the team or global admin. Non-member → 403 `TEAM_ACCESS_DENIED` (no data leaked). Missing team → 404 `TEAM_NOT_FOUND`. |
| GET | `/api/teams/:teamId/members` | Bearer | Same rule as above. |
| POST | `/api/teams/:teamId/members` | Bearer | Team ADMIN or global admin. `{ userId | email, role }`. Unknown user → 404, duplicate → 409 `MEMBERSHIP_EXISTS`. |
| DELETE | `/api/teams/:teamId/members/:userId` | Bearer | Team ADMIN or global admin. Refuses to remove the last ADMIN → 409 `CANNOT_REMOVE_LAST_ADMIN`. |

All errors use `{ error: { code, message, details? } }`. Validation failures → 400
`VALIDATION_ERROR`; missing/malformed header → 401 `UNAUTHENTICATED`; bad/expired
token → 401 `INVALID_TOKEN`.

### Permission matrix

Implemented in `backend/src/auth/permissions.ts` and locked by unit tests:

| Action | global admin | team ADMIN | MANAGER | MEMBER | outsider |
|---|---|---|---|---|---|
| `teams:create` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `teams:view` / `listMembers` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `teams:addMember` / `removeMember` | ✅ | ✅ | ❌ | ❌ | ❌ |

Global admin (`User.isGlobalAdmin`) and team ADMIN (`Membership.role`) are distinct:
a team ADMIN administers membership within one team only and cannot create teams
or read other teams. (MANAGER gains work-item powers in M1.2+; here it is read-only.)

### Demo bootstrap

```powershell
Copy-Item .env.example .env   # then set a real JWT_SECRET
docker compose up -d postgres
npm install
npm run prisma:migrate
npm run seed -w backend       # idempotent; refuses production unless ALLOW_SEED_PRODUCTION=true
```

Dev-only accounts (see `.env.example`, overridable via `SEED_*`): `admin@example.com`
(global admin), `manager.alpha@example.com` (MANAGER of Ops Central),
`member.alpha@example.com` (MEMBER), `outsider@example.com` (no team).

### Verify (M1.1)

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/newtonite?schema=public'
$env:JWT_SECRET = 'a-long-test-secret-at-least-32-chars!!'
npm run typecheck -w backend
npm run test -w backend
npx prisma validate --schema prisma/schema.prisma  # from backend/
```

Expected: typecheck clean; 4 test files / 22 tests pass
(health 2, permissions 4, auth 9, teams 7); schema valid.

### Known limitations (M1.1)

- No refresh tokens / revocation list — delete the user to invalidate; token lifetime (default 12h) bounds exposure.
- No rate limiting on login yet (needed before internet exposure).
- Team existence is distinguishable (403 vs 404) — accepted for an internal tool; see ENGINEERING_DECISIONS.
- No work-item CRUD and no React login UI yet (explicitly out of scope for M1.1).

---

## M1.2 — Work-item lifecycle (implemented)

### Endpoints (all require Bearer auth; team membership enforced per resource)

| Method | Path | Rule |
|---|---|---|
| POST | `/api/work-items` | Any team member (any role) or global admin. Body: `{ teamId, title, description, priority?, assigneeId? }`. Items are born `OPEN` (no status field). `assigneeId` must be a member of the team → else 422 `ASSIGNEE_NOT_TEAM_MEMBER`. No `createdById` field exists — creator is the token owner. |
| GET | `/api/work-items` | Scoped: `teamId` filter (access-checked) or caller's teams (global admin: all). Filters: `status`, `priority`, `assigneeId`, `mine=true`, `q` (title+description, DB-side `contains`). Pagination: `page` ≥ 1, `pageSize` 1–100 (default 20). Deterministic order `updatedAt desc, id desc`. → `{ items, page, pageSize, total, totalPages }`. |
| GET | `/api/work-items/:id` | Member of the item's team or global admin (cross-team guess → 403, unknown id → 404). Includes team/assignee/creator, latest 10 comments (oldest-first), `commentCount`, `activityCount`. |
| PATCH | `/api/work-items/:id` | `{ expectedVersion, title?, description?, priority?, status?, assigneeId?/null }`. Title/desc/priority: any member. Status/assignment: MANAGER/ADMIN/global-admin only (→ 403 `ROLE_REQUIRED`). Illegal transition → 422 `INVALID_STATUS_TRANSITION` (with `allowed`). Stale version → 409 `VERSION_CONFLICT`, item + history untouched. Identical-values retry → 200 no-op, same version. |
| POST | `/api/work-items/:id/comments` | Any member. `{ body }` (1–5000 chars). Creates comment + `COMMENTED` event atomically; does not bump item version. |
| GET | `/api/work-items/:id/activity` | Paginated `{ events, page, pageSize, total, totalPages }`, newest-first. Events carry `actorId`, `action`, `detail` (before/after), `version`, timestamp. |

Errors keep the M1.1 envelope. New codes: `WORK_ITEM_NOT_FOUND`,
`ASSIGNEE_NOT_TEAM_MEMBER`, `INVALID_STATUS_TRANSITION`, `VERSION_CONFLICT`.

### Workflow matrix (`backend/src/work-items/transitions.ts`, unit-locked)

| From | Allowed next |
|---|---|
| OPEN | IN_PROGRESS, CLOSED |
| IN_PROGRESS | BLOCKED, IN_REVIEW |
| BLOCKED | IN_PROGRESS, CLOSED |
| IN_REVIEW | IN_PROGRESS, DONE, BLOCKED |
| DONE | CLOSED, IN_PROGRESS (reopen) |
| CLOSED | IN_PROGRESS (reopen) |

Same-status PATCH is a no-op (allowed). No approval workflow beyond IN_REVIEW→DONE
was invented; no status values were added.

### Work-item permission rules (additive — M1.1 team matrix untouched)

| Action | global admin | ADMIN | MANAGER | MEMBER | outsider |
|---|---|---|---|---|---|
| create / view / edit fields / comment | ✅ | ✅ | ✅ | ✅ | ❌ |
| change status or assignment | ✅ | ✅ | ✅ | ❌ | ❌ |

### Verify (M1.2)

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/newtonite?schema=public'
$env:JWT_SECRET = 'a-long-test-secret-at-least-32-chars!!'
npm run typecheck -w backend   # clean (src + tests + seed)
npm run test -w backend        # 6 files / 35 pass (22 prior + 13 new, incl. real-Postgres concurrency)
npm run build -w backend       # clean
npx prisma validate --schema prisma/schema.prisma  # valid, DB in sync — no new migration
npm run typecheck -w frontend; npm run test -w frontend  # unchanged green (3 pass)
```

### Known limitations (M1.2, current)

- No refresh tokens / revocation list; no login rate limiting (carried from M1.1).
- Text search is `contains` (case-insensitive) without a trigram index — fine at current scale; add `pg_trgm` if search becomes hot.
- List filters accept single `status`/`priority` values (no multi-select yet).
- No React work-item UI yet; API only.
- Team/item existence distinguishable via 403-vs-404 (accepted internal-tool trade-off).

---

## M1.3 — React frontend (implemented)

### Startup (full stack)

```powershell
Copy-Item .env.example .env   # then set a real JWT_SECRET
docker compose up -d postgres
npm install
npm run prisma:migrate
npm run seed -w backend       # dev-only demo accounts (idempotent)
npm run dev:backend           # :3001 (terminal 1)
npm run dev:frontend          # :5173, proxies /api → :3001 (terminal 2)
```

Open http://localhost:5173. Sign in with a seeded account, e.g.
`admin@example.com` / `Admin123!` (overridable via `SEED_*` in `.env`).

### End-to-end demo flow

1. **Login** — seeded credentials → `POST /api/auth/login`; token in
   `localStorage` (`newtonite.token`); identity via `GET /api/auth/me`.
2. **Dashboard** — status/total/mine/urgent metrics (server-side counts), team /
   status / priority / assignee / mine / text filters, paginated table
   (Key, Title, Status, Priority, Team, Assignee, Updated). Click a row to open it.
3. **Create** — "New work item" (team, title, description, priority, assignee).
4. **Detail** — edit title/description/priority; MANAGER+ also sees status
   (only legal transitions, DONE and CLOSED kept distinct) and assignee pickers;
   MEMBER sees a read-only note. Every save sends `expectedVersion`.
5. **Conflict** — edit the same item in two tabs/sessions; the second save gets
   409, keeps the draft, explains the situation, and offers "Reload latest".
6. **Comments + activity** — post comments (version unchanged), browse the
   newest-first timeline with "Load more".
7. **Logout** — header button clears the token; expired tokens (401) log out
   automatically with a "session expired" message on next login.

### Verify (M1.3)

```powershell
npm run typecheck -w frontend  # clean
npm run test -w frontend       # 5 files / 17 pass (API contracts, App shell, Dashboard, Detail, Login; fetch mocked)
npm run build -w frontend      # clean production build
npm run test -w backend        # 6 files / 35 pass — backend untouched, still green
```

Frontend tests mock `fetch` for component behavior; every URL/method/body is
asserted against the real backend routes in `src/api.test.ts`, and backend
correctness stays covered by the Postgres integration suite.

### Known limitations (M1.3, current)

- No signup page (registration stays API-only; admins come from seed).
- Metrics are per-status count queries (8 lightweight `pageSize=1` requests per
  filter change) rather than a dedicated aggregate endpoint.
- No optimistic UI on save — the list/detail refresh from the server after writes.
- No auto-refresh/polling; a second tab's changes surface on next load or via the
  409 path. No offline support.
- **No idempotency keys: duplicate POSTs create duplicates.** Buttons disable
  while a request is pending (best-effort), but two rapid submissions — or a
  retry after a timeout — create two work items/comments. Verified live:
  two identical comment POSTs returned 201 + 201 with two stored comments.
  A real fix needs client-generated idempotency keys + a server dedupe record.
- Auth/baseline limitations from M1.1–M1.2 still apply.
