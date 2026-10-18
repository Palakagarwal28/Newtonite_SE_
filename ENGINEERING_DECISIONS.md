# Engineering Decisions (M0 — Foundation)

## 1. Monorepo with npm workspaces (`frontend/`, `backend/`)
**Why:** one clone, one `npm install`, shared issue tracking; keeps the one-day scope manageable.
**Trade-off:** no independent versioning/deploy pipelines vs. polyrepo. Acceptable at this scale;
split later if teams/services diverge.
**Alternative rejected:** single mixed package — would entangle Vite and Express toolchains.

## 2. PostgreSQL + Prisma, schema-first with forward-compatible tables
**Why:** tens of thousands of work items + growing history need indexed, transactional storage —
`@@index([teamId, status])`, `@@index([workItemId, createdAt])` are in from day one.
Prisma gives typed access and migrations without hand-written SQL.
Schema already includes `User/Team/Membership/WorkItem(version)/Comment/ActivityEvent`
so M1 (authz + CRUD + 409) needs no breaking migration.
**Trade-off:** Postgres via Docker adds a local dependency vs. SQLite.
Justification: concurrency semantics (our core assessment risk) cannot be proven on SQLite.
Tests that need no DB use supertest/jsdom; DB integration tests start in M1.

## 3. Express minimal API with `/api` prefix, JSON error envelope, Vite proxy
**Why:** smallest surface that proves frontend→backend wiring; `{ error: { code, message } }`
envelope standardizes 404/500 handling early. Vite `proxy: /api` avoids CORS in dev.
**Trade-off:** no API versioning (`/api/v1`) yet — add when breaking changes appear.

## 4. `version: Int` on WorkItem from the start, enforcement deferred to M1
**Why:** optimistic concurrency (`If-Match`-style `expectedVersion` → `409 Conflict`) is a
required correctness behavior. Putting the column in M0 avoids a later backfill;
enforcement + tests land in M1 with the update path.
**Trade-off:** column exists before any writer uses it — harmless default `1`.

## 5. What we intentionally did NOT build (one-day scope guard)
No JWT/session auth, no work-item CRUD, no transition state machine, no search/pagination,
no async queue (Redis/BullMQ), no WebSockets. Each would be half-done in the time available.
Planned order: M1 authz + work items + 409 + transitions + audit writes (transactional),
M2 comments/history + search/filter/pagination, M3 idempotency + frontend 409 reconciliation.

## Assumptions
- Internal tool: email+password users seeded later; SSO out of scope.
- Team roles `ADMIN | MEMBER | VIEWER` cover the brief's "different responsibilities".
- Status flow `OPEN → IN_PROGRESS → {BLOCKED | IN_REVIEW} → DONE → CLOSED` (illegal jumps rejected by backend in M1).

---

# M1.1 — Authentication & team authorization

## 6. Stateless JWT Bearer tokens (not server sessions)
**Why:** suits the existing split architecture (Express API + Vite SPA, possibly
multiple API instances): no session store to share/scale, `Authorization: Bearer`
works through the Vite dev proxy unchanged, and expiry (`JWT_EXPIRES_IN`, default
12h) bounds stolen-token exposure.
**Trade-off:** no instant revocation list — a token stays valid until expiry even if
the role changes. Mitigations: `requireAuth` reloads the user row per request so
delete takes effect immediately and `isGlobalAdmin` flips do too; token-lifetime
keeps the window small. Refresh-token rotation + denylist deferred to hardening.
**Rejected:** stateful sessions (needs Redis/store + CSRF handling — more infra than
a one-day budget allows); trusting a client-supplied user id (never implemented —
identity comes only from verified `sub`).

## 7. bcryptjs hashing, generic credential errors
Passwords are hashed with bcrypt (cost 10) and never stored/logged/returned;
`GET /register` response and all queries exclude `passwordHash`. Login returns
401 `INVALID_CREDENTIALS` for unknown email, missing hash, and wrong password
identically, so attackers cannot enumerate accounts. bcryptjs (pure JS) chosen over
native bcrypt/argon2 to avoid Windows build toolchains in the assessment environment;
cost factor is env-tunable (`BCRYPT_ROUNDS`), upgrade path to argon2id documented.
No password-strength meter server-side beyond min-length 8 — internal tool, avoid
false security theatre; rate limiting is the honest next step (noted, not built).

## 8. Two-level admin: `User.isGlobalAdmin` ≠ team `ADMIN` (+ new `MANAGER`)
Schema change: `Role` is now `ADMIN | MANAGER | MEMBER` (replacing `VIEWER`, no data
existed so no data migration) and `User.isGlobalAdmin` marks platform admins.
Global admins create teams and read any team; team ADMINs manage membership of one
team only. The matrix lives as data (`PERMISSION_MATRIX` in
`backend/src/auth/permissions.ts`) with pure `can*` helpers, and unit tests assert
the literal matrix so a refactor cannot silently widen access. Public registration
uses `.strict()` schemas and hardcodes `isGlobalAdmin: false` — a smuggled
`isGlobalAdmin: true` yields 400 and creates nothing (tested). Team ADMIN cannot
grant global adminship — no endpoint exists for it; only seed/bootstrap sets it.

## 9. 403 (not 404) for cross-team denial; last-ADMIN guard
Guessing another team's id returns 403 `TEAM_ACCESS_DENIED` with no team data, while
a truly missing id returns 404. This leaks team existence to authenticated users,
accepted deliberately: for an internal ops tool, debuggability beats ID-oracle
paranoia (ids are unguessable cuids anyway). All team endpoints re-check membership
per request — no cached "my teams" list is trusted. Membership removal refuses to
delete the last ADMIN (409 `CANNOT_REMOVE_LAST_ADMIN`) so a team can never be
orphaned without an administrator.

## 10. Seed script as the bootstrap (no public admin creation)
`backend/prisma/seed.ts` (`npm run seed -w backend`) is the minimum reproducible
bootstrap: idempotent upserts of global admin + two teams + MANAGER/MEMBER/outsider
coverage, overridable via `SEED_*` env vars, refuses production without explicit
override, and prints only emails (never passwords/hashes). Combined with
unique-per-test isolated fixtures in `backend/tests/` (no shared/manual DB rows),
reviewers can reproduce auth, cross-team denial, and role tests deterministically.

---

# M1.2 — Work-item lifecycle

## 11. Thin handlers, service owns the rules (`src/work-items/service.ts`)
Routes (`src/routes/work-items.ts`) only authenticate, validate with zod
`.strict()`, and serialize; every authorization, transition, concurrency, and
audit decision lives in the service. This keeps the six endpoints consistent and
makes the rules testable without HTTP. Work-item role checks are additive
helpers in `permissions.ts` — the M1.1 `PERMISSION_MATRIX` object is byte-for-byte
unchanged (its unit test still locks it), so team semantics cannot drift.
Differentiation point: any member may create/edit/comment, but status and
assignment require MANAGER/ADMIN/global-admin — the "MANAGER work-item powers"
foreshadowed in M1.1.

## 12. Atomic optimistic concurrency via conditional `updateMany`
PATCH requires `expectedVersion`; the write is a single
`updateMany({ where: { id, version: expectedVersion }, data: { …, version: { increment: 1 } } })`.
`count === 0` → 409 with no writes and no events (verified by test: item and
activity count unchanged). Two concurrent same-version requests against real
PostgreSQL → exactly one 200, one 409 (integration-tested, not mocked — SQLite
cannot prove this). Deliberately NOT read-then-unconditional-write: the pre-read
serves only validation/diffing. Bonus correctness: identical-value retries return
200 as a no-op without bumping the version, covering the brief's "user repeating
an action because unsure it succeeded". Comments never bump `version`, so
discussion cannot invalidate in-flight edits.

## 13. Backend-owned transition matrix, 422 for semantic violations
`STATUS_TRANSITIONS` (OPEN→IN_PROGRESS/CLOSED … IN_REVIEW→DONE … DONE/CLOSED→
IN_PROGRESS reopen) is enforced in the service before any write; illegal jumps
get 422 `INVALID_STATUS_TRANSITION` with `{ from, to, allowed }`, and assignees
outside the team get 422 `ASSIGNEE_NOT_TEAM_MEMBER`. 422 (not 400) marks
well-formed-but-against-the-rules requests, distinct from malformed bodies (400)
and forbidden roles (403). No new statuses, no approval workflow — IN_REVIEW→DONE
is the existing approval gate. Items are always born OPEN; `teamId` is immutable,
so cross-team moves are impossible by construction.

## 14. Transactional audit: mutation and events commit together
Create/update/comment wrap the write plus all `ActivityEvent` rows
(`CREATED/UPDATED/STATUS_CHANGED/ASSIGNED/UNASSIGNED/PRIORITY_CHANGED/COMMENTED`
with actor, before/after payloads, and resulting-version snapshot) in one Prisma
`$transaction`. Rejected operations (403/404/409/422) throw before any write, so
no successful-looking events exist for failed operations — asserted by tests
comparing activity totals across a 409. Events store `actorId` from the verified
token, never from the body.

## 15. Database-side search/pagination; no migration needed
List/activity use `where` + `take/skip` + `count` in the database (bounded
`pageSize ≤ 100`, deterministic `updatedAt desc, id desc` ordering, response
`{ items/events, page, pageSize, total, totalPages }`) — the full table is never
loaded into Node. Unscoped list defaults to the caller's teams (global admin:
all). The M0 schema already had the needed indexes
(`[teamId,status]`, `[teamId,priority]`, `[assigneeId]`, `[teamId,updatedAt]`,
`[workItemId,createdAt]`), so M1.2 required **no migration** (`migrate status`:
in sync). `q` uses case-insensitive `contains`; a `pg_trgm` index is the
documented next step if search load grows.

---

# M1.3 — React frontend

## 16. Typed API client as the contract anchor (`frontend/src/api.ts`)
All backend knowledge lives in one module: response/request types, exact query
keys, `expectedVersion` on PATCH, and the `{ error: { code, message, details } }`
envelope parsed into `ApiError`. `src/api.test.ts` asserts URLs, methods, and
bodies against the real routes, so contract drift fails fast in CI; component
tests then mock only `fetch`. Backend correctness is deliberately NOT re-proven
in the browser — the Postgres integration suite remains the authority. No new
runtime dependencies (React + fetch only).

## 17. Display-only role/transition mirrors, server still decides
`rules.ts` copies the transition matrix and MANAGER+ gating purely to choose
which controls to render (e.g. MEMBER sees status as text with an explanatory
note). Every submission path still handles 401/403/409/422 from the server, and
unit tests assert MEMBER PATCH bodies contain no `status` key. Hidden buttons
are documented as UX, not security — a MEMBER forging a status PATCH still gets
403 from the backend.

## 18. 409 recovery: preserve, explain, never auto-retry
On `VERSION_CONFLICT` the detail view keeps the rejected payload visible
("your attempted changes" list), refreshes server state for comparison, and
offers explicit "Reload latest (keeps my draft)" / "Discard my changes" actions.
Retrying the stale payload against the new version is forbidden by design — the
user re-submits deliberately after reviewing. Identical-value saves are sent
normally (the backend already no-ops them), and in-flight requests disable their
buttons to prevent duplicate submissions.

## 19. Server-side everything; no client state cache
Search (300 ms debounce), filters, and pagination all re-query the API; the
client keeps no work-item store, so a 403/404/409 always reflects current server
truth. Trade-off: dashboard metrics cost ~8 `pageSize=1` count queries per
filter change instead of one aggregate endpoint — accepted to avoid adding a
backend endpoint for M1.3; a `GET /api/work-items/stats` is the natural
follow-up. Local form state is kept separate from fetched data and re-seeded on
every load, so a refresh never resurrects stale edits except through the
explicit 409 draft path.

## 20. localStorage JWT — explicit trade-off, architecture unchanged (audit)
The access token lives in `localStorage` (`newtonite.token`) and is sent as a
Bearer header. Chosen for: zero cookie/CSRF plumbing, works unchanged through
the Vite dev proxy and across multiple API instances, trivial logout (delete
the key). Risk, stated plainly: any XSS vulnerability in the app exfiltrates the
token (httpOnly cookies would not). Accepted because: internal tool with no
user-supplied HTML rendering (no `dangerouslySetInnerHTML` anywhere), short
12h token lifetime, per-request user reload so deletes take effect, and no
sensitive claims in the token. The honest upgrade path is httpOnly + SameSite
cookies with CSRF tokens (or refresh-token rotation) — deliberately deferred as
more infrastructure than the current milestones justify. No silent change made
during the audit.
