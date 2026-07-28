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

Arquivo: `src/lib/treasury/treasuryFeatureFlags.ts` + ordem/UI em `treasuryRollout.ts`.  
Detalhe operacional: [19-ROLLOUT.md](./19-ROLLOUT.md).

| Flag ID | Env | Escopo |
|---------|-----|--------|
| `treasury.enabled` | `TREASURY_MODULE_ENABLED` | Mestra |
| `treasury.accounts.enabled` | `TREASURY_ACCOUNTS_ENABLED` | Contas / ledger manual |
| `treasury.balances.enabled` | `TREASURY_BALANCES_ENABLED` | Saldos / snapshots / posição |
| `treasury.dashboard.enabled` | `TREASURY_DASHBOARD_ENABLED` | Dashboard / alertas leitura |
| `treasury.receivables.enabled` | `TREASURY_RECEIVABLES_ENABLED` | AR + cobrança/disputa |
| `treasury.payables.enabled` | `TREASURY_PAYABLES_ENABLED` | AP (consulta) |
| `treasury.projection.enabled` | `TREASURY_PROJECTION_ENABLED` | Projeção/agenda/compare |
| `treasury.promises.enabled` | `TREASURY_PROMISES_ENABLED` | Promessas CR |
| `treasury.payablesProgramming.enabled` | `TREASURY_PAYABLES_PROGRAMMING_ENABLED` | Programação CP |
| `treasury.transfers.enabled` | `TREASURY_TRANSFERS_ENABLED` | Transferências |
| `treasury.exceptions.enabled` | `TREASURY_EXCEPTIONS_ENABLED` | Exceções |
| `treasury.dailyClosing.enabled` | `TREASURY_DAILY_CLOSING_ENABLED` | Fechamento |
| `treasury.reconciliation.enabled` | `TREASURY_RECONCILIATION_ENABLED` | Conciliação/movimentos |
| `treasury.ofxImport.enabled` | `TREASURY_OFX_IMPORT_ENABLED` | Preview/apply OFX |
| `treasury.reports.enabled` | `TREASURY_REPORTS_ENABLED` | Relatórios + export |

Valores truthy: `1`, `true`, `yes`, `on`. Valores falsy: `0`, `false`, `no`, `off`.  
**Mestra:** env **ausente** = **OFF** (opt-in; ver [ACTIVATION.md](./ACTIVATION.md)).  
**Subflags (mestra ON):** env ausente = ON; opt-out explícito = OFF.  
**Fail-closed:** flag ID desconhecida → OFF; valor env desconhecido → OFF. Subflags exigem mestra ON (AND).

`GET /availability` devolve `flags` (mapa completo) para a UI ocultar abas.

## 7. Operação de liberação

1. Migrar schema (já aplicado se o módulo foi implantado).
2. Deploy do código (**não** ativa sozinho — mestra permanece OFF sem env).
3. Seed aditivo: `npm run treasury:permissions:seed` (dry-run) → revisar → `--apply`.
4. **Não** usar `permissions:seed -- --sync-role-defaults` para esta ativação.
5. Configurar `TREASURY_MODULE_ENABLED=1` e reiniciar o serviço.
6. Validar `GET /availability` (campo `flags`) e smoke UI.
7. Opt-out emergencial: `TREASURY_MODULE_ENABLED=0` + restart.

Detalhe: [ACTIVATION.md](./ACTIVATION.md) e [19-ROLLOUT.md](./19-ROLLOUT.md). Flag OFF **não** apaga dados.
