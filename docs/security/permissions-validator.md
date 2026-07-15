# Validador automático de permissões (Prompt 03)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Ativo — não altera runtime de auth |
| **Pré-req** | Prompt 01 (auditoria) · Prompt 02 (contrato) |
| **Código** | `src/lib/security/permissionAudit/` |
| **CLI** | `scripts/auditPermissionContract.ts` |

---

## Objetivo

Detectar divergências entre contrato canônico, catálogo legado, seed relacional, sidebar, abas, uso FE/BE e guards de rotas — **sem** mudar acessos.

## Comandos

```bash
npm run audit:permission-contract          # alias do modo relatório
npm run audit:permission-contract:report   # exit 0; grava relatório
npm run audit:permission-contract:strict   # exit 1 se erro estrutural novo
npm run audit:permission-contract:full     # mesmo critério do strict + relatório
npm run test:permission-audit              # testes unitários do validador
```

Relatório gerado (sem PII): `docs/generated/permission-contract-audit-report.md`

## Como funciona

1. **Fontes tipadas** — importa `PERMISSION_CATALOG`, `PERMISSION_CONTRACT_RESOURCES`, `PERMISSION_RESOURCE_SEEDS`, sidebar, abas CRM/comissões/finance/portfolio.
2. **AST TypeScript** (`typescript` package) — extrai literais de `hasPermission` / `requirePermission` / `requireResourcePermission` / `canView` e rotas `app|router.METHOD`.
3. **Heurística de guards nomeados** — reconhece `manageGuard`, `...paymentsManageGuard`, `...g.checklistOps` (fleet).
4. **Known gaps** — allowlist em `knownGaps.ts` (gaps Prompt 01/02); não falham `--strict`.

## Códigos de finding

| Código | Significado |
|--------|-------------|
| `USED_NOT_IN_CATALOG` | Literal usado ∉ catálogo |
| `CATALOG_NEVER_USED` | Chave catalogada sem literal no scan |
| `CONTRACT_ISSUE` / parent inválido | Contrato quebrado |
| `ALIAS_MISSING_FROM_CATALOG` | Alias do contrato inválido |
| `SIDEBAR_WITHOUT_CONTRACT` | Módulo sidebar sem `moduleId` no contrato |
| `TAB_WITHOUT_CONTRACT` | Aba UI sem ponte contrato |
| `MUTATION_WITHOUT_PERMISSION_GUARD` | Mutação API sem guard detectável |
| `MUTATION_AUTH_ONLY` | Só `requireAppAuth` no middleware |
| `CONTRACT_ACTION_UNUSED` | Ação canônica sem legacy no scan |
| `FE_BE_GUARD_STYLE_MISMATCH` | Ex.: `configuracoes` vs `admin`; sync OR |

## Limitações conhecidas

- Spreads importados de outros arquivos / middleware factory complexa podem escapar.
- Checks **inline** no handler (SUPER_ADMIN) → `MUTATION_AUTH_ONLY` / known gap.
- Botões sensíveis sem `hasPermission` **não** são classificados automaticamente (fase futura).
- `CATALOG_NEVER_USED` ignora uso só via constantes tipadas sem literal no call site.
- Não acessa banco nem produção.

## Relação com `audit:permissions`

`npm run audit:permissions` (`scripts/auditPermissionsV1.ts`) continua disponível (foco `server.ts` + regex). O validador Prompt 03 é a trilha oficial contrato × AST × known gaps.
