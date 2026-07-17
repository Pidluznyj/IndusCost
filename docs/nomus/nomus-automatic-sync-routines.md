# SYNC-07 — Rotinas automáticas no CRUD canônico Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-07 (roteamento canônico; ops presence permanece em SYNC-07 policy) |
| **Pré-requisitos** | SYNC-01…06 |
| **Atualizado** | 2026-07-17 |
| **Escopo** | Entradas automáticas/manuais → `runNomus*Sync` · **sem** novo sincronizador/agendador · **sem** mudança de consumidores |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Rotinas automáticas? | Pedidos ~2h; CR/CP `17 */2`; daily comercial (sem SO/AR/AP) |
| 2 | Onde registradas? | crontab host + `package.json` + spawn admin |
| 3 | cron + systemd + scheduler interno? | Só cron host; **sem** systemd Nomus; **sem** cron Node |
| 4 | npm/shell? | Ver matriz |
| 5 | Painel = mesmo serviço? | **Sim** — shell → npm → `runNomus*Sync` |
| 6 | Orquestrador diário? | Chama npm filhos; **não** inclui SO/AR/AP no `runNomusDailySync.sh` |
| 7 | Locks? | Global (daily/SO), AR, AP, entity canonical, reconcile |
| 8 | Ignora lifecycle? | RECENT_WINDOW não avalia ausência (por contrato) |
| 9 | Hooks duplicados? | Mitigado: uma vez por run + correlationId; preview sem hooks |
| 10 | full_refresh parcial? | **Sim** — label ≠ COMPLETE; ausência fail-closed |

---

## Matriz

| Entidade | Disparador | Frequência | Script | Estratégia | Escrita | Lock | Serviço canônico |
|----------|------------|------------|--------|------------|---------|------|------------------|
| Pedidos | SCHEDULED_HOURLY | ~2h | `runNomusSalesOrdersSync.sh` | RECENT_WINDOW | sim | global + entity | `runNomusSalesOrdersSync` |
| Pedidos | CLI wide | ad-hoc | `runNomusSalesOrdersWideReconciliation.sh` | FULL_RECONCILIATION | sim | global + entity | idem |
| Pedidos | ORCHESTRATOR | manual `sync:nomus:all` | `nomusSyncOrchestrator.ts` | RECENT_WINDOW | sim | child | idem |
| CR | SCHEDULED_HOURLY | `17 */2` | `runNomusAccountsReceivableSync.sh` | FULL_RECONCILIATION* | sim | AR | `runNomusAccountsReceivableSync` |
| CR | ADMIN_PANEL | on demand | mesmo shell | idem | sim | AR | idem |
| CP | SCHEDULED_HOURLY | `17 */2` | `runNomusAccountsPayableSync.sh` | FULL_RECONCILIATION* | sim | AP | `runNomusAccountsPayableSync` |
| CP | ADMIN_PANEL | on demand | mesmo shell | idem | sim | AP | idem |

\* Label legado `full_refresh_upsert` **não** prova completude.

---

## Serviços canônicos

```
runNomusSalesOrdersSync
runNomusAccountsReceivableSync
runNomusAccountsPayableSync
```

Path: `src/lib/nomus/nomusCanonicalSync.server.ts`  
Contrato: `src/lib/nomus/nomusCanonicalSyncContract.ts`

Todo request declara: entity, strategy, mode, scope, sourceTrigger, allowMissing*, requestedBy, correlationId.

### Estratégias

| Strategy | CREATE/UPDATE/REACTIVATE | Ausência |
|----------|-------------------------------|----------|
| RECENT_WINDOW | sim | **nunca** |
| FULL_RECONCILIATION | sim | só payload COMPLETE + flag |
| TARGETED_LOOKUP | alvo | só o alvo, com flag |

---

## Rotina horária de Pedidos

- `strategy = RECENT_WINDOW`
- `allowMissingDetection = false`
- `allowMissingConfirmation = false`
- Cria/atualiza/reativa/lastSeenAt
- **Não** incrementa missing nem confirma ausência
- Pedidos fora da janela permanecem inalterados

---

## Orquestrador diário

Ordem oficial preservada: customers → products → bom-components → proposals (`runNomusDailySync.sh`).

`nomusSyncOrchestrator` pode incluir `sales-orders` com env explícito `RECENT_WINDOW` / `ORCHESTRATOR`.

Falha em uma etapa: registrada; **não** inventa payload completo; **não** confirma ausências.

---

## CR / CP automáticos

Escopo real: janela de vencimento + `apenasPendentes` (env).  
Automático inicia com ausência **off** (`ALLOW_MISSING_DETECTION=0`).  
CREATE/UPDATE/reativação de retornados ativos.

---

## Locks

| Nome | Uso |
|------|-----|
| `nomus-orchestrator-global` | daily + SO shells |
| `nomus-sales-orders` | entity canonical |
| `nomus-accounts-receivable` | CR |
| `nomus-accounts-payable` | CP |

Colisão → `SKIPPED_LOCKED` (não destrutivo).

---

## Hooks pós-sync

| Hook | SO | CR | CP | Preview |
|------|----|----|----|---------|
| commissionMaterialization | sim | sim | não | não |
| crmCommercialOwnerAutoAssign | sim | não | não | não |
| productionOrdersAfterSalesOrders | sim | não | não | não |
| salesOrderFlowRecompute | sim | não | não | não |

Uma vez por run; correlationId em env; falha de apply → não roda.

---

## Flags (independentes)

```
NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED
NOMUS_SOURCE_RECONCILE_AR_ENABLED
NOMUS_SOURCE_RECONCILE_AP_ENABLED
NOMUS_OPS_EXCLUDE_MISSING_*   # consumidores — não alterados aqui
```

Estado seguro inicial: CREATE/UPDATE on; ausência automática off/preview; ops exclude off.

---

## Painel

AR/AP: `NomusAccounts*SyncCard` → runners com `SOURCE_TRIGGER=ADMIN_PANEL`.  
Backend rejeita `allowMissingConfirmation` em estratégia incompatível (`sanitizeAdminMissingFlags`).

---

## Comandos manuais equivalentes

```bash
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:sales-orders:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-receivable:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-payable:apply
```

---

## Código

| Peça | Path |
|------|------|
| Contrato | `src/lib/nomus/nomusCanonicalSyncContract.ts` |
| Gateway | `src/lib/nomus/nomusCanonicalSync.server.ts` |
| Testes | `src/lib/nomus/nomusCanonicalSyncContract.test.ts` |
| Runbook lifecycle | `docs/nomus/nomus-source-reconciliation-runbook.md` |
