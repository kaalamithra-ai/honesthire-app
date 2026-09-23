# Honest Hire — Recruiting Platform

Local-first recruiting demo: a static frontend (`index.html` + `backend-client.js`)
served by an Express API backed by MongoDB (Mongoose). No build step, no replica
set — loopback-only demo, do not expose publicly.

## Prerequisites

- Node.js 20.19+ (`node --version`)
- MongoDB running on `127.0.0.1:27017` (plain standalone instance is enough)
- PowerShell on Windows (commands below) or any shell elsewhere

## Quick start

```powershell
Set-Location 'c:\Users\Dzone\Downloads\stitch_honest_hire_recruiting_platform (1)\backend'
npm install
npm run db:seed
npm start
```

Then open **http://127.0.0.1:5000/index.html** (or `#/candidates`).
Express serves the frontend **and** the API together — no Python server needed.
`run-website.bat` / `serve.py` are legacy frontend-only launchers and still
require this backend running separately for live data.

## Configuration

Copy `backend/.env.example` to `backend/.env` to override defaults
(environment variables take precedence over the file):

| Variable       | Default                           | Purpose                                   |
| -------------- | --------------------------------- | ----------------------------------------- |
| `MONGODB_URI`  | `mongodb://127.0.0.1:27017/honest_hire` | MongoDB database                    |
| `PORT`         | `5000`                            | Express port (binds `127.0.0.1` only)     |
| `CORS_ORIGINS` | see `.env.example`                | Allowlist for separately hosted frontends |

For a custom frontend/backend port combo, set `window.HONEST_HIRE_API_BASE`
before loading `backend-client.js` and allow the frontend origin in
`CORS_ORIGINS`. Prefer the Express URL over opening the HTML file directly.

## API overview

Base URL: `http://localhost:5000` (or `http://127.0.0.1:5000`).

### GET `/api/health`

MongoDB ping. `200 { status: "ok", database: "connected" }`, or `503` when
MongoDB is unavailable.

### GET `/api/candidates`

Ranked candidate feed, trust score descending. Every search or filter change
in the UI calls this endpoint (server-side filtering):

| Param                | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `q`                  | Case-insensitive substring over name, role, verified skills |
| `reqCode`            | Requisition via linked pipelines (`all` = any)              |
| `minTrust`           | `0`–`100` minimum trust score                               |
| `tier`               | `1`–`5` for that clearance tier and above, or `any`         |
| `verificationStatus` | `verified`, `in_progress`, `pending`, or `all`              |
| `stage`              | `1`–`5` for an exact pipeline step, or `any`                |

Response: `{ items, total, matched, reqCodes }` — `total` is all candidates,
`matched` the filtered count, `reqCodes` every requisition. Each item carries
the Candidate fields plus `_id`/timestamps and its `pipeline` (if any).
Invalid params return `400`.

### GET `/api/pipeline/:candidateId`

Pipeline document for that candidate's MongoDB `_id`. Invalid IDs return
`400`, missing pipelines `404`. (`/api/pipeline` without an ID is not a list
endpoint.) Elena's seeded ID is `000000000000000000004091`:
http://127.0.0.1:5000/api/pipeline/000000000000000000004091

### PATCH `/api/pipeline/:candidateId`

Body must be exactly one key: `{ "action": "advance" | "offer" | "hold" | "reject" }`.

| Action    | Effect                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `advance` | Exactly one step forward (max 5), sets `in_progress`                        |
| `offer`   | **Audit-gated:** Step 5 **and** 100% completion only, sets `completed`      |
| `hold`    | Keeps the step, sets `on_hold`                                              |
| `reject`  | Keeps the step, sets `rejected`                                             |

Errors: invalid ID/action return `400`, missing pipeline `404`, rule violation
`409`. Elena sits below 100% completion (98%), so offering her returns `409`:

```powershell
Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:5000/api/pipeline/000000000000000000004091 `
  -ContentType 'application/json' -Body '{ "action": "offer" }'
# Action failed: Final offer requires Step 5 and 100% completion.
```

## Frontend

- Team login is real: the header form calls `POST /api/auth/login` with one of
  the seeded demo accounts (`Ava Recruiter <hiring@honesthire.app>`, password
  `hire1234`, or interviewers `Tara Lin` / `Sam Patel`, password `panel1234`),
  stores the opaque bearer token as `hh-token`, and hides hiring data behind
  the logged-out gate until a valid session exists (`GET /api/auth/me` on
  load). Every feedback entry and document upload records the signed-in
  member; a `401` reopens the login modal.
- `#/candidates` and `#/pipeline` are live MongoDB views: debounced
  server-side search/filters, candidate selection, live actions, `#live-toast`
  confirmations, loading/empty/error states, manual Refresh (no push updates).
  Stale responses are ignored, never merged. DB strings render via
  `textContent`.
- `#/pipeline` has its own real-time filter bar (search + pipeline stage,
  verification status, clearance tier) over the same `GET /api/candidates`
  endpoint, so it never rewrites the `#/candidates` list. The dossier card
  shows the candidate profile, and the documents card lists GridFS files with
  View/Download links plus upload and per-file Remove controls (signed-in
  members only). The **Add candidate** modal also accepts a resume/ID file
  that is uploaded to the new record after it is created.
- `#/checks` **Accept & Issue Final Offer** (`#checks-offer`) is wired: it sends
  `PATCH /api/pipeline/:id { "action": "offer" }` (top-ranked candidate when
  none is selected yet) and writes success **or** the `409` audit error into
  `#live-toast`, then reveals the pipeline tab so the toast is visible. The
  `#/pipeline` Offer button (`#live-offer`) stays disabled unless Step 5 + 100%.
- `#/interviews` keeps its demo schedules but merges live MongoDB candidates by
  name into the same list (extra roster members appear as schedule-less
  rows), adds real-time search plus pipeline stage / verification status /
  clearance tier dropdowns, and the feedback modal submits
  `PATCH /api/candidates/:id/feedback` with the bearer token — the saved
  entry records the signed-in author shown in the modal.
- Checks and messages remain the original independent demo
  features — not real verification or messaging.

## Architecture

```text
browser (index.html + backend-client.js, hash tabs)
  │  fetch (same origin, or window.HONEST_HIRE_API_BASE)
  ▼
Express (backend/src: server.js → app.js → mongo-routes.js)
  │  Mongoose models (Candidate, Pipeline) · validation.js HttpError → JSON
  ▼
MongoDB 127.0.0.1:27017/honest_hire (one Pipeline per Candidate, reqCode on Pipeline)
```

| Path                            | Role                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `index.html`                    | All views/tabs, loads `backend-client.js` + `admin-client.js`                 |
| `backend-client.js`             | Live feed, pipeline panel, documents, actions, `#live-toast` |
| `admin-client.js`               | Admin Dashboard: fetches `/api/admin/metrics` + team, renders live counts   |
| `backend/src/server.js`         | Startup, loopback bind, graceful shutdown                 |
| `backend/src/app.js`            | Express wiring, CORS allowlist, static frontend, errors   |
| `backend/src/mongo-routes.js`   | `GET /api/candidates[?stage=]`, `GET /api/candidates/:id`, `GET/PATCH /api/pipeline/:id`, documents routes, `PATCH /api/candidates/:id/feedback`, `PATCH /api/candidates/:id/checks` |
| `backend/src/auth-routes.js`    | `POST /api/auth/login|logout`, `GET /api/auth/me|team`     |
| `backend/src/admin-routes.js`   | `GET /api/admin/overview|metrics|team|audit|analytics`, team CRUD + session revocation (admin-only, audited) |
| `backend/src/metrics.js`        | Live MongoDB snapshot for the Admin Dashboard (`dashboardMetrics`) |
| `backend/src/portal-routes.js` | `GET /api/portal/me`, `POST /api/portal/documents` (candidate own-application portal, role + record scoped) |
| `backend/src/auth.js`           | scrypt passwords, opaque sessions, `requireUser` / `requireRole` / `requireStaff` / `requireCandidate` / `requireOwnCandidate` guards |
| `backend/src/documents.js`      | GridFS bucket `candidateFiles`, signature checks          |
| `backend/src/models/*.js`       | Mongoose `Candidate` (with `documents`) / `Pipeline` / `User` (role + optional `candidateId`) / `Session` / `AuditLog` schemas |
| `backend/seed.js`               | 4 fictional pairs + 7 demo accounts (Ava + recruiter@, Tara + Sam + interviewer@, Morgan admin, candidate@ portal linked to Elena), stable IDs, rerunnable upserts |
| `backend/test/api.test.js`      | API tests incl. the candidate-vs-staff role matrix (isolated `honest_hire_test_<pid>` DB) |
| `backend/test/frontend.test.js` | Client tests via Node VM + DOM stub                       |

Seed: Elena Rostova (98, Tier 5, 98%), Marcus Chen (94, Step 5/100%),
Priya Nair (85, pending), David Okafor (82) — all on `REQ-4091`.

### Roles & navigation

Three signed-in roles drive both the header nav and the API guards (nav hiding is
presentation-only; every mutating or record read is enforced server-side):

| Role | Seed accounts (password) | Nav tabs | API surface |
| ---- | ------------------------ | -------- | ----------- |
| Admin | `admin@honesthire.app` (`SHAMANTH@KAALAMITHRA`) | Candidates, Checks, Interviews, Pipeline, Admin Dashboard (+ Audit Logs) | Full API + `/api/admin/*` |
| Employee | `recruiter@honesthire.app`, `hiring@honesthire.app` (`hire1234`); `interviewer@honesthire.app`, `tara.lin@honesthire.app`, `sam.patel@honesthire.app` (`panel1234`) | Candidates Feed, Interviews, Pipeline | Vetting, pipeline, feedback, internal uploads/downloads |
| Candidate | `candidate@honesthire.app` (`candidate1234`, linked to Elena Rostova) | My Application (Candidate Portal) | `GET /api/portal/me`, `POST /api/portal/documents`, own-document downloads, own-record scoped feed |

Login uses the role-linked email plus `POST /api/auth/login`; candidates reaching
admin (`403` + audited `access_denied`), mutating, or other candidates' records
(`404` for cross-record reads/downloads, `403` for cross-record writes) are refused.

- `PATCH /api/candidates/:id/feedback`: append one interview feedback entry to that
  candidate in MongoDB. Requires an `Authorization: Bearer <token>` session;
  body must be exactly `{ "text": "…" }` (non-empty, max
  2000 chars). Returns the updated candidate with a `feedback` array whose
  latest entry carries the signed-in `author`, `authorId` and `role`. `401` for
  a missing/expired token, `403` for candidate-role callers (staff-only endpoint), `400` for bad IDs or invalid text, `404` if the
  candidate is not in the roster. Example:

  ```powershell
  $login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/api/auth/login `
    -ContentType 'application/json' -Body '{ "email": "tara.lin@honesthire.app", "password": "panel1234" }'
  Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:5000/api/candidates/000000000000000000004091/feedback `
    -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($login.token)" } `
    -Body '{ "text": "Strong systems depth, clear communicator." }'
  ```

- `PATCH /api/candidates/:id/checks`: staff-only, audited background-checks update.
  Body accepts `verificationStatus` (`verified`, `in_progress` or `pending`) and/or
  `idDocuments` (string array); at least one is required. The change persists on the
  candidate record, so the feed's `verificationStatus` filter and the Admin Dashboard
  metrics reflect it immediately. `401` without a session, `403` for candidate-role
  callers, `400` for bad IDs or invalid fields, `404` if the candidate is not in the
  roster. Every change is recorded in `AuditLog` as `checks_updated`.

### Admin API

`GET /api/admin/*` and team-management routes are guarded by a strict admin
gate (`requireUser` + role check). Non-admins receive `403`, signed-out
requests `401`, and every attempt is recorded in `AuditLog`.

| Route                       | Method   | Body / Params                          | Returns                                    |
| --------------------------- | -------- | -------------------------------------- | ------------------------------------------ |
| `/api/admin/overview`       | **GET**  | —                                      | `{ health, candidates: { total }, sessions: { active }, storage }` |
| `/api/admin/metrics`        | **GET**  | `?reqCode=<code>`                      | One live MongoDB snapshot for the whole dashboard: `{ generatedAt, health: { status, database, uptime, uptimeSeconds }, candidates: { total, byVerification, byTier, averageTrustScore }, pipelines: { total, statusCounts, stageDistribution, averageDaysToHire, offerAcceptanceRate }, sessions: { active, staff, candidates, byRole }, users, storage: { files, bytes, note } (live GridFS), requisitions, audit }` |
| `/api/admin/team`           | **GET**  | —                                      | Array of `[{ id, name, email, role, active, sessionCount }]` (no password hashes) |
| `/api/admin/team`           | **POST** | `{ name, email, role, password }`      | `201` created team member                   |
| `/api/admin/team/:id`       | **PATCH**| `{ role?, active? }`                   | Updated member (self-demotion → `409`)     |
| `/api/admin/team/:id/sessions` | **DELETE** | —                                | `{ revoked }` — count of revoked sessions   |
| `/api/admin/audit`          | **GET**  | `?action=<name>&limit=<n>`             | `{ items, count, limit }` (most-recent-first) |
| `/api/admin/analytics`      | **GET**  | `?reqCode=<code>`                      | `statusCounts, offerAcceptanceRate, averageDaysToHire, candidatesPerRequisition` |

The Admin Dashboard appears as a new `#/admin` tab in `index.html`, visible
only to signed-in admins. `admin-client.js` fills every card from the live
`/api/admin/metrics` snapshot — fetched when the page opens on `#/admin`, when
the tab is activated, and on the **Refresh** click — plus `/api/admin/team` for
the roster. The dashes (—) in the markup are placeholders that give way to real
database counts: candidates, active sessions (staff and candidate logins read
from the `sessions` collection), offer acceptance, average days to hire,
pipeline status counts, GridFS storage usage and requisition load. The
`admin@honesthire.app` seeded account (`SHAMANTH@KAALAMITHRA`) is
pre-provisioned with `role: admin`.

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/api/auth/login `
  -ContentType 'application/json' -Body '{ "email": "admin@honesthire.app", "password": "SHAMANTH@KAALAMITHRA", "adminKey": "<ADMIN_SECRET_KEY from backend/.env>" }'
Invoke-RestMethod -Uri http://127.0.0.1:5000/api/admin/overview `
  -Headers @{ Authorization = "Bearer $($login.token)" }
```

## Scripts and verification

```powershell
Set-Location 'c:\Users\Dzone\Downloads\stitch_honest_hire_recruiting_platform (1)\backend'
npm start       # serve frontend + API on :5000
npm run dev     # same with --watch
npm run db:seed # (re)seed demo data, preserving records and edits
npm test        # 31/31: API + frontend suites, test DB dropped afterwards
```

`DESIGN.md` holds the visual system. `backend/README.md` documents the API in
more depth. `backend/src/routes.js` + `backend/prisma/` are inactive Prisma
legacy, not loaded by the server.

