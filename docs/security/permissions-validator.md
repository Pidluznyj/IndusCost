# Validador automático de permissões (Prompt 03 + P02)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Ativo — não altera runtime de auth |
| **P02 (consistência)** | `docs/security/permissions-consistency.md` · `npm run check:permission-consistency:strict` |
| **Prompt 03 (AST)** | `src/lib/security/permissionAudit/` · `npm run audit:permission-contract:strict` |

---

## P02 — Consistência contrato × seed × FE × sidebar

Comando oficial CI: **`npm run check:permission-consistency:strict`**.

Detecta divergências entre fontes tipadas e **impede novos gaps** via baseline em `permissionConsistency/baseline.ts`.  
Gaps históricos (ex.: `admin.employees` no FE sem seed) ficam baselined até as fases de alinhamento de catálogo.

Detalhes: [`permissions-consistency.md`](./permissions-consistency.md).

---

## Prompt 03 — Auditor AST (catálogo × uso × mutações)

### Objetivo

Detectar divergências entre contrato canônico, catálogo legado, seed relacional, sidebar, abas, uso FE/BE e guards de rotas — **sem** mudar acessos.

### Comandos

```bash
npm run audit:permission-contract          # alias do modo relatório
npm run audit:permission-contract:report   # exit 0; grava relatório
npm run audit:permission-contract:strict   # exit 1 se erro estrutural novo
npm run audit:permission-contract:full     # mesmo critério do strict + relatório
npm run test:permission-audit              # testes unitários do validador
```

Relatório gerado (sem PII): `docs/generated/permission-contract-audit-report.md`

### Como funciona

1. **Fontes tipadas** — importa `PERMISSION_CATALOG`, `PERMISSION_CONTRACT_RESOURCES`, `PERMISSION_RESOURCE_SEEDS`, sidebar, abas CRM/comissões/finance/portfolio.
2. **AST TypeScript** — extrai literais de `hasPermission` / `requirePermission` / `requireResourcePermission` / `canView` e rotas.
3. **Known gaps** — allowlist em `knownGaps.ts`; não falham `--strict`.

### Limitações

- Spreads / middleware factory complexa podem escapar.
- Checks inline no handler → `MUTATION_AUTH_ONLY` / known gap.
- Não acessa banco nem produção.

### Relação

`audit:permissions` (V1) continua disponível. **P02** é a trilha oficial de paridade de catálogos com baseline anti-regressão; Prompt 03 cobre uso literal e mutações via AST.
