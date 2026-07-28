# Permissões e feature flags — Central de Tesouraria

Código: `treasuryAccess.ts`, `treasuryPermissions.ts`, `treasuryFeatureFlags.ts`, `permissionCatalog.ts`, `permissionContract/resources.ts`.

## 1. Princípios

1. Backend é a autoridade (`requireResource`).
2. Deny > allow; recurso desconhecido = deny.
3. Flag mestra **e** subflag (quando existir) devem estar ON (AND).
4. Bags `finance.view` **não** abrem Tesouraria (isolamento de irmãos).
5. Leituras CR/CP Tesouraria também exigem `finance.accounts_receivable|payable` `view`.

## 2. Resources canônicos

| Resource | Uso típico |
|----------|------------|
| `finance.treasury` | Shell / export raiz |
| `finance.treasury.dashboard` | Dashboard, forecast-vs-actual, alerts |
| `finance.treasury.agenda` | Agenda |
| `finance.treasury.receivables` | Lista/detalhe CR + expectativa/disputa |
| `finance.treasury.receivables.promise` | Promessas |
| `finance.treasury.receivables.collection` | Cobrança |
| `finance.treasury.payables` | Lista/detalhe CP + payment-schedule |
| `finance.treasury.payables.program` | Programação de pagamento |
| `finance.treasury.accounts` | Contas / ACL / leitura saldos |
| `finance.treasury.balances` | Criar snapshot de saldo |
| `finance.treasury.transfers` | Transferências |
| `finance.treasury.manual_entries` | Ledger manual |
| `finance.treasury.reconciliation` | OFX/movimentos/match |
| `finance.treasury.reconciliation.reverse` | Reverse forte |
| `finance.treasury.exceptions` | Exceções + PUT alert-settings |
| `finance.treasury.closing` | Fechamento (`view`/`close`/`reopen`) |
| `finance.treasury.audit` | Consulta auditoria |
| `finance.treasury.reports` | Relatórios |

## 3. Actions

`view`, `create`, `update`, `execute`, `manage`, `export`, `close`, `reopen`.

## 4. Capabilities (matriz interna)

Exemplos (`TreasuryCapabilityId`): `viewModule`, `viewDashboard`, `manageReceivables`, `promiseReceivables`, `collectReceivables`, `programPayables`, `manageBalances`, `manageTransfers`, `manageManualEntries`, `manageReconciliation`, `reverseReconciliation`, `closeDay`, `reopenDay`, `viewAudit`, `export`.

Avaliação: `canTreasuryCapability(user, capabilityId)`.

## 5. Bags legadas (catálogo)

Lista em `TREASURY_LEGACY_BAG_KEYS` — formato `finance.treasury.<área>.<ação>` (ex.: `finance.treasury.closing.close`).  
Seed/contrato: `permissions:seed:contract:*` / admin de permissões.

## 6. Feature flags

Arquivo: `src/lib/treasury/treasuryFeatureFlags.ts`.

| Flag ID | Env | Escopo |
|---------|-----|--------|
| `treasury.enabled` | `TREASURY_MODULE_ENABLED` | Mestra (fail-closed) |
| `treasury.accounts.enabled` | `TREASURY_ACCOUNTS_ENABLED` | Contas |
| `treasury.projection.enabled` | `TREASURY_PROJECTION_ENABLED` | Projeção/agenda calculate |
| `treasury.promises.enabled` | `TREASURY_PROMISES_ENABLED` | Promessas |
| `treasury.payablesProgramming.enabled` | `TREASURY_PAYABLES_PROGRAMMING_ENABLED` | Programação CP |
| `treasury.transfers.enabled` | `TREASURY_TRANSFERS_ENABLED` | Transferências |
| `treasury.exceptions.enabled` | `TREASURY_EXCEPTIONS_ENABLED` | Exceções |
| `treasury.dailyClosing.enabled` | `TREASURY_DAILY_CLOSING_ENABLED` | Fechamento |
| `treasury.reconciliation.enabled` | `TREASURY_RECONCILIATION_ENABLED` | Conciliação/movimentos |
| `treasury.ofxImport.enabled` | `TREASURY_OFX_IMPORT_ENABLED` | Preview/apply OFX |

Valores truthy típicos: `1`, `true`, `yes`, `on` (ver parser no código). Ausente/`0`/`false` = OFF.

## 7. Operação de liberação

1. Migrar schema.
2. Ligar `TREASURY_MODULE_ENABLED=1`.
3. Ligar subflags do escopo homologado.
4. Conceder bags/resources aos papéis (financeiro, tesoureiro, auditor).
5. Validar `GET /availability` e smoke UI.

**Homologação:** flags OFF em produção até checklist OK (soft-launch).
