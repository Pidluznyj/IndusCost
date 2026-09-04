# CLAUDE.md

## Codebase Overview

IndusCost Intelligence is a full-stack industrial costing, pricing, and management platform: a single Express + Vite/React service (`server.ts`) backed by PostgreSQL via Prisma, with data synced from the Nomus ERP. It covers Finance/Treasury, Sales Orders, Supply Chain/Purchasing, Fleet, Commissions, Pricing/Costing, HR, and Admin/Permissions, with a strong "official engine" convention: canonical calculation modules that all UI/API consumers must read from, protected from ad-hoc recomputation. The UI is in Portuguese (pt-BR); most architecture/decision documentation lives under `docs/` as dated, ticket-numbered audit trails.

**Stack**: TypeScript, Express (`server.ts`), React + Vite SPA, PostgreSQL via Prisma, Nomus ERP sync integration, Tailwind, `tsx` for dev/test runtime, Node's built-in test runner.

**Structure**: `src/components/*` (feature UI by domain), `src/lib/*` (business logic, engines, services — mirrors the component domains), `src/types/*` (domain types), `src/contexts`/`src/hooks` (auth/permissions), `prisma/` (schema + migrations), `docs/` (architecture, audits, runbooks, per-domain policy docs), `scripts/` (CLI/audit/backfill tooling).

For detailed architecture, module guide, data flows, conventions, and gotchas, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).
