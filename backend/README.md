# Honest Hire — local MongoDB API

Requires Node.js 20.19+ and a running MongoDB instance on 127.0.0.1:27017.

## Start (PowerShell)

```powershell
Set-Location 'c:\Users\Dzone\Downloads\stitch_honest_hire_recruiting_platform (1)\backend'
npm install
# Optional: copy .env.example to .env and change MONGODB_URI / PORT.
npm run db:seed
npm start
```

Open http://127.0.0.1:5000/#/candidates. Express serves the frontend and API together; no Python server is needed. The server binds only to loopback. The existing Python launchers serve only the frontend and still require this backend running separately.

Configuration file: `c:\Users\Dzone\Downloads\stitch_honest_hire_recruiting_platform (1)\backend\.env`.
Default MONGODB_URI: `mongodb://127.0.0.1:27017/honest_hire`. Environment variables take precedence over the file. PORT defaults to 5000. CORS_ORIGINS is a comma-separated allowlist for separately hosted frontends. For a custom frontend/backend port combination, set `window.HONEST_HIRE_API_BASE` before loading the client script and allow the frontend origin in CORS_ORIGINS. Prefer the Express URL over opening HTML directly.

## API

- `GET /api/health`: MongoDB ping; 200 connected or 503 unavailable.
- `GET /api/candidates`: `{ items: [...], total: number, matched: number, reqCodes: [...] }`, sorted by descending trust score. Each item contains the Candidate fields (including `documents` metadata and `feedback`), MongoDB `_id`, timestamps, and optional `pipeline` metadata. `total` is all candidates, `matched` is the filtered count, and `reqCodes` lists every requisition. Optional query filters: `q` (case-insensitive substring for name, role or skills), `reqCode` (matches requisitions through linked pipelines), `minTrust` (0–100), `tier` (`1`–`5` for that tier and above, or `any`), `verificationStatus` (`verified`, `in_progress`, `pending`, or `all`), and `stage` (`1`–`5` for an exact pipeline step, or `any`). `reqCode` and `stage` are intersected when combined. Invalid query parameters return 400.
- `GET /api/candidates/:id`: one candidate plus its pipeline (`pipeline: null` when unassigned). Invalid IDs return 400, unknown IDs 404.
- `POST /api/auth/login`: `{ email, password }` → `{ token, expiresAt, user: { id, name, email, role } }`. Unknown accounts and wrong passwords both return `401 {"error":"Invalid email or password."}`. Invalid bodies return 400.
- `POST /api/auth/logout`: `Authorization: Bearer <token>`, deletes the session and returns 204. Missing/expired/unknown tokens return 401.
- `GET /api/auth/me`: the signed-in member for the bearer token (401 without a valid token).
- `GET /api/auth/team`: names, emails and roles of the active team accounts, so the login screen can offer them. Password hashes and salts are never returned.
- `POST /api/candidates/:id/documents?kind=resume|id_verification|other&name=<filename>` (requires a bearer token): the request body **is** the file (raw bytes, not multipart). `Content-Type` must be one of `application/pdf`, `image/png`, `image/jpeg`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`. The bytes are signature-checked (a "PDF" that is not `%PDF-…` is rejected), capped at 8 MB, and stored in the GridFS bucket `candidateFiles` with metadata mirrored on the candidate. Returns 201 with the stored `document` record. `400` for a bad kind/id, `401` without a session, `404` for an unknown candidate, `413` when too large, `415` for an unsupported type or a mismatched signature.
- `GET /api/candidates/:id/documents`: `{ candidateId, candidateName, items: [{ fileId, name, kind, contentType, size, uploadedBy, uploadedAt }] }`.
- `GET /api/documents/:fileId`: streams the stored file (`Content-Disposition: inline`; add `?download=1` for an attachment). Invalid IDs 400, unknown files 404.
- `DELETE /api/candidates/:id/documents/:fileId` (requires a bearer token): removes the metadata and the GridFS file, returns the remaining documents. `401` without a session, `404` when the candidate or file is unknown.
- `PATCH /api/candidates/:id/feedback` (requires a bearer token): body must be exactly `{ "text": "…" }` (non-empty, max 2000 characters). Appends one interview feedback entry authored by the signed-in team member — `{ text, author, authorId, role, createdAt }` — and returns the updated candidate. `401` without a session, `400` for bad IDs or invalid text, `404` if the candidate is not in the roster. Example:

  ```powershell
  $login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/api/auth/login `
    -ContentType 'application/json' -Body '{ "email": "tara.lin@honesthire.app", "password": "panel1234" }'
  Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:5000/api/candidates/000000000000000000004091/feedback `
    -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($login.token)" } `
    -Body '{ "text": "Strong systems depth, clear communicator." }'
  ```
- `PATCH /api/candidates/:id/checks` (staff-only, audited as `checks_updated`): body must contain one or both of `{ "verificationStatus": "verified" | "in_progress" | "pending" }` and `{ "idDocuments": ["…"] }` (string array, each entry ≤ 200 chars). Persists the background-checks state on the candidate record — the same fields the feed's `verificationStatus` filter and the Admin Dashboard metrics read — and returns the updated candidate. `401` without a session, `403` for candidate-role callers, `400` for bad IDs or invalid fields, `404` if the candidate is not in the roster.
- `GET /api/pipeline/:candidateId`: pipeline document for that candidate's MongoDB `_id`. Invalid IDs return 400; missing pipelines return 404. `/api/pipeline` without an ID is not a list endpoint.
- `PATCH /api/pipeline/:candidateId`: `{ action: "advance" | "offer" | "hold" | "reject" }`. `advance` moves exactly one step forward (max 5) and sets `in_progress`; `offer` is audit-gated to Step 5 **and** 100% completion and sets `completed` (no jumps allowed); `hold`/`reject` keep the step and set `on_hold`/`rejected`. Invalid IDs or actions return 400, missing pipelines 404, rule violations 409.
- `POST /api/candidates`: create a real candidate (and optional `pipeline`). Required: `name`, `role`, `location` (non-empty strings), `trustScore` (integer 0–100), `clearanceTier` (integer 1–5). Optional: `verifiedSkills`, `idDocuments` (string arrays, comma-separated in the UI), `verificationStatus` (`pending` default, `in_progress`, `verified`), `pipeline` (`reqCode` required, `currentStep` 1–5, `completionPercentage` 0–100, `status`). Returns 201 with the saved candidate and its pipeline. Unknown fields, invalid ranges, or an unusable pipeline return 400; a pipeline failure rolls back the candidate so no orphan remains.

Elena's seeded ID is `000000000000000000004091`: http://127.0.0.1:5000/api/pipeline/000000000000000000004091.

Candidate fields: name, role, trustScore (0–100), clearanceTier (integer 1–5), verifiedSkills (string array), location, verificationStatus (`verified`, `in_progress`, `pending`), idDocuments (string array). Attached-file metadata mirrors the GridFS upload in `documents` (`fileId`, `name`, `kind`, `contentType`, `size`, `uploadedBy`, `uploadedAt`). Every feedback entry records the signed-in author (`author`, `authorId`, `role`) with `text` and `createdAt`. Elena's seed includes `Verified US Passport`; Priya's pending status uses `Passport verification pending`.
Pipeline fields: candidateId (unique ObjectId reference), reqCode, currentStep (integer 1–5), completionPercentage (0–100), status (`pending`, `in_progress`, `completed`, `on_hold`, `rejected`). One pipeline per candidate. Requisition is stored on Pipeline, not Candidate.

The seed inserts four fictional candidate/pipeline pairs, including Elena Rostova, score 98, Staff Distributed Systems Architect, REQ-4091. Stable IDs and insert-only upserts preserve existing records and avoid duplicates on reruns. A seedVersion upgrade updates older records with verification statuses and IDs (the seed can be run repeatedly without duplicating or overwriting later edits). It also inserts three demo team accounts used by the login screen — `Ava Recruiter <hiring@honesthire.app>` (password `hire1234`, role `recruiter`), plus interviewers `Tara Lin <tara.lin@honesthire.app>` and `Sam Patel <sam.patel@honesthire.app>` (password `panel1234`); passwords are stored as scrypt hashes, and reseeding never resets a password that was changed. No replica set/transactions are required. `npm run db:clean` removes only those four demo candidates (matched by ID and name), their pipelines and GridFS files, plus the three seeded team accounts and their sessions, leaving manually added candidates intact; clearing any active filters is recommended afterward so new records are visible.

## Frontend scope

Candidates and Pipeline are live MongoDB views with debounced server-side search, server-side filters, candidate selection, live actions, toast confirmations, loading/empty/error states, and Refresh. The Pipeline tab owns a separate filter feed (`#pp-search`, `#pp-stage`, `#pp-verification`, `#pp-tier`, plus reset) over the same `GET /api/candidates` endpoint, so narrowing the pipeline list never rewrites the Candidates tab. Each search or filter change calls `GET /api/candidates` with query parameters; the client ignores stale responses instead of merging them. The "Add candidate" modal (`#cv-add-open` → `#cv-add-form`) posts to `POST /api/candidates`, shows server validation errors inline, then reloads the feed and opens the new candidate's pipeline so the UI reflects MongoDB without a manual refresh; an attached resume/ID file (`#cv-add-file` + `#cv-add-kind`) is uploaded raw to `POST /api/candidates/:id/documents` right after the record is created and needs a signed-in member. The candidate dossier (`#pp-profile`) shows the profile alongside the tracker, and the documents card lists GridFS files (`#pp-documents`) with View/Download links, an upload picker (`#pp-doc-file` + `#pp-doc-kind` + `#pp-doc-upload`) and per-file Remove buttons — all stored in MongoDB GridFS. The Interviews list keeps its demo schedules but merges live MongoDB candidates by name into the same entries (extra roster members appear as schedule-less rows), adds real-time search plus stage/verification/clearance dropdowns (`#iv-stage`, `#iv-verification`, `#iv-tier`) with a reset, and the feedback modal submits `PATCH /api/candidates/:id/feedback` with the bearer token so the saved entry records the signed-in author shown in the modal. Login is real: the header form calls `POST /api/auth/login`, offers the seeded team accounts (`GET /api/auth/team`), stores the opaque token in localStorage as `hh-token` (validated against `GET /api/auth/me` on load, expired tokens clear the session), and shows/hides hiring data with the logged-out gate; logout calls `POST /api/auth/logout`. Unauthenticated feedback/uploads are blocked with a 401 and reopen the login modal. Action buttons call `PATCH /api/pipeline/:candidateId`; the Offer button is disabled unless the pipeline is at Step 5 with 100% completion. A toast confirms success or shows the backend error. Refresh is manual (not websocket/push updates). Pipeline progress uses the database percentage, not an inferred stage percentage. Database strings are rendered using textContent.

Checks and messages remain the original independent demo features, not real verification or messaging services. The old Prisma files remain as inactive legacy source; they are not loaded by the server, and old CRUD/interview routes are not mounted. Existing SQLite data is not migrated. The auth, feedback and document endpoints are real, but this is still a loopback-only local demo — do not expose it publicly.

## Verification

```powershell
Set-Location 'c:\Users\Dzone\Downloads\stitch_honest_hire_recruiting_platform (1)\backend'
npm test
```

API integration tests use a separate `honest_hire_test_<pid>` database on local MongoDB and delete only that test database afterward. Frontend tests use Node's built-in VM and a DOM stub; they are not a visual browser test.
