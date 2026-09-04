# AGENTS.md

## Codebase Overview

IndusCost Intelligence is a full-stack industrial costing, pricing, and management platform: a single Express + Vite/React service (`server.ts`) backed by PostgreSQL via Prisma, with data synced from the Nomus ERP. It covers Finance/Treasury, Sales Orders, Supply Chain/Purchasing, Fleet, Commissions, Pricing/Costing, HR, and Admin/Permissions, with a strong "official engine" convention: canonical calculation modules that all UI/API consumers must read from, protected from ad-hoc recomputation.

**Stack**: TypeScript, Express (`server.ts`), React + Vite SPA, PostgreSQL via Prisma, Nomus ERP sync integration, Tailwind, `tsx` for dev/test runtime.

**Structure**: `src/components/*` (feature UI by domain), `src/lib/*` (business logic/engines, mirrors component domains), `src/types/*`, `prisma/` (schema + migrations), `docs/` (architecture, audits, runbooks), `scripts/` (CLI/audit/backfill tooling).

For detailed architecture, module guide, data flows, conventions, and gotchas, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Cursor Cloud specific instructions

**Product:** IndusCost Intelligence — a full-stack industrial costing / pricing / management platform.
It is a single web service: Express API + Vite/React SPA served from one process (`server.ts`),
backed by PostgreSQL via Prisma. UI is in Portuguese (pt-BR). See `README.md` and `package.json`
scripts for standard commands.

### Services & how to run them

- **PostgreSQL (required):** installed in the environment but is **not** auto-started on boot.
  Start it each session with `sudo pg_ctlcluster 16 main start`. Local dev DB is `induscost`
  (role `postgres` / password `postgres`).
- **Web app (required):** `npm run dev` (runs `tsx server.ts`) serves both the API and the SPA on
  `http://localhost:3000`. Note: `tsx` does **not** type-check, and it does **not** reload on `.env`
  changes — restart the process after editing `.env`.

### Environment config

- App reads `.env` (via `dotenv`). `.env` is gitignored. Minimum needed for local dev:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/induscost?schema=public"`.
  See `.env.example` for all optional vars (Gemini, Nomus ERP sync, Brent collector, bootstrap admin).

### Database schema — important gotcha

- The Prisma **migration history is NOT self-contained from scratch**: the earliest migration
  (`20260410120000_purchases_block1`) references pre-existing tables (e.g. `Material`), so
  `prisma migrate deploy` **fails on a fresh database**.
- For a fresh local dev DB, sync the schema directly instead:
  `npx prisma db push`. (`prisma generate` runs automatically via the `postinstall` hook.)

### Auth — creating the first user (fresh DB has no users)

The API requires an authenticated `AppUser`; a fresh DB has none. Bootstrap the first SUPER_ADMIN:
1. In `.env` set `BOOTSTRAP_ADMIN_ENABLED="true"` plus `BOOTSTRAP_ADMIN_USERNAME`,
   `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_SESSION_SECRET`, then restart the server.
2. `POST /api/bootstrap-admin/login` (username/password) to get a cookie.
3. `POST /api/admin/users/bootstrap-super-admin` with `{name,email,password}` (uses that cookie)
   to create a SUPER_ADMIN.
4. Log in normally via `POST /api/auth/login` with `{email,password}`.

### Lint / test / build

- Lint: `npm run lint` (`tsc --noEmit`). Currently fails due to **pre-existing** syntax errors in
  `scripts/preview-commission-customer-exclusion-impact.ts` (a standalone script, unrelated to the
  running app which uses `tsx`). Not caused by environment setup.
- Tests: `npm test` (Node test runner via `tsx --test`, ~230 tests). Requires a running PostgreSQL
  with `DATABASE_URL` set. Focused suites exist too (e.g. `npm run test:market-intelligence`).
- Build (prod bundle): `npm run build` (Vite → `dist/`). Not needed for dev.
