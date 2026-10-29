# CLAUDE.md

## Codebase Overview

IndusCost Intelligence is a full-stack industrial costing, pricing, and management platform: a single Express + Vite/React service (`server.ts`) backed by PostgreSQL via Prisma, with data synced from the Nomus ERP. It covers Finance/Treasury, Sales Orders, Supply Chain/Purchasing, Fleet, Commissions, Pricing/Costing, HR, and Admin/Permissions, with a strong "official engine" convention: canonical calculation modules that all UI/API consumers must read from, protected from ad-hoc recomputation. The UI is in Portuguese (pt-BR); most architecture/decision documentation lives under `docs/` as dated, ticket-numbered audit trails.

**Stack**: TypeScript, Express (`server.ts`), React + Vite SPA, PostgreSQL via Prisma, Nomus ERP sync integration, Tailwind, `tsx` for dev/test runtime, Node's built-in test runner.

**Structure**: `src/components/*` (feature UI by domain), `src/lib/*` (business logic, engines, services — mirrors the component domains), `src/types/*` (domain types), `src/contexts`/`src/hooks` (auth/permissions), `prisma/` (schema + migrations), `docs/` (architecture, audits, runbooks, per-domain policy docs), `scripts/` (CLI/audit/backfill tooling).

For detailed architecture, module guide, data flows, conventions, and gotchas, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Testes — proporcionais ao impacto (vale para o Claude e para todos os desenvolvedores)

**Onde roda cada coisa**

- **Local (desenvolvimento, Claude/Cursor):** só testes rápidos **sem banco real** — unitários, simulados (stubs) do
  executor de deploy, regressões sem banco, isolamento de `IDS_*`/`PG*`, typecheck e verificações estáticas. Nunca
  iniciar PostgreSQL, criar banco de teste, instalar PostgreSQL nem conectar a servidor real.
- **Homologação (`servidor-01`):** validação completa — suíte inteira, integrações e E2E com PostgreSQL 17 real
  (`npm run test:pg17`, em cluster descartável do harness; **nunca** em `teste_bi_homolog`), build, migrations.
- **Produção:** só a publicação controlada da release aprovada em homologação, com os controles do executor.

Os testes com PostgreSQL real (`*.pg17.*`, `*Postgres*.integration.test.*`) só iniciam o cluster descartável com a
opção explícita `INDUSCOST_REAL_PG_TESTS=1` + `COMMISSION_PG17_BIN` (o harness recusa sem ela, e `npm test`,
`test:quick`, `test:affected`, `test:full` removem as duas): sem a opção, eles aparecem como **ignorados**.

**Comandos** (`scripts/testing/runTestTier.mjs`; cada um imprime comando, abrangência e motivo, duração, testes,
aprovados, reprovados e ignorados, e guarda a saída completa em arquivo; sai ≠ 0 se algo falhar):

| Comando | Abrangência | Quando |
|---|---|---|
| `npm run test:quick` | testes alterados + os do mesmo módulo dos arquivos alterados | a cada alteração |
| `npm run test:affected` | todo teste que importa (transitivamente) um arquivo alterado; + executor se `infra/deploy`/`scripts/ops` mudou | antes de entregar risco médio/alto |
| `npm run test:deploy-safety` | executor, biblioteca, instalador, hooks, isolamento do gate (simulados) | qualquer mudança em deploy |
| `npm run test:critical` | deploy + segurança, autenticação e permissões | risco alto |
| `npm run test:full` | todos os testes sem banco real | raramente local; o gate completo é na homologação |
| `npm run test:pg17` | integrações PostgreSQL 17 real | **só no servidor-01** (recusa com 2 fora dele) |

`--list` mostra a seleção sem rodar; `--base=<ref>` muda a referência (padrão `origin/main`).

**Risco da alteração → testes antes de entregar** (considerar arquivos compartilhados e efeitos indiretos):

- **Baixo** (interface, estilo, textos, componente isolado): `test:quick`.
- **Médio** (regras de negócio, cálculos, integrações): `test:affected` (módulo + consumidores) e typecheck.
- **Alto** (banco, migrations, autenticação, permissões, financeiro, deploy, segurança): `test:affected` +
  `test:critical` (ou `test:deploy-safety`) + typecheck; o que exigir PostgreSQL real fica para `test:pg17` na
  homologação, descrito na entrega.

Regras: não rodar `npm test`/`test:full` a cada pequena alteração; não rodar duas suítes completas ao mesmo tempo;
não repetir `npm ci`, `prisma generate` ou build sem mudança que os exija; reaproveitar um resultado só se código,
dependências e configuração relevantes não mudaram desde ele. A suíte completa continua obrigatória na homologação,
antes da aprovação da release.
