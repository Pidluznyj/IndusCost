# SYNC-07 — Rotinas automáticas no CRUD canônico Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-07 (roteamento canônico; ops presence permanece em SYNC-07 policy) |
| **Pré-requisitos** | SYNC-01…06 |
| **Atualizado** | 2026-08-03 |
| **Escopo** | Entradas automáticas/manuais → `runNomus*Sync` · **sem** novo sincronizador/agendador · **sem** mudança de consumidores |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Rotinas automáticas? | Pedidos ~2h; CR/CP `17 */2`; Propostas `37 * * * *` (SYNC-07); daily comercial (customers/products/bom/proposals, 02:00) |
| 2 | Onde registradas? | crontab host + `package.json` + spawn admin |
| 3 | cron + systemd + scheduler interno? | Só cron host; **sem** systemd Nomus; **sem** cron Node |
| 4 | npm/shell? | Ver matriz |
| 5 | Painel = mesmo serviço? | **Sim** — shell → npm → `runNomus*Sync` |
| 6 | Orquestrador diário? | Chama npm filhos; **não** inclui SO/AR/AP no `runNomusDailySync.sh` (propostas continua incluída, agora também horária) |
| 7 | Locks? | Global (daily/SO), AR, AP, entity canonical, reconcile, propostas (entity + probe do global) |
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
| Propostas | SCHEDULED_DAILY | `0 2 * * *` | `runNomusDailySync.sh` (via orquestrador, `--only=proposals`) | full scan (sem checkpoint — arquitetura atual não é incremental) | sim | propostas (entity) | `nomusProposalsSyncV1.ts` (`sync:nomus:proposals:apply`) |
| Propostas | SCHEDULED_HOURLY | `37 * * * *` | `runNomusProposalsHourlySync.sh` (SYNC-07) | full scan (idem) | sim | propostas (entity) + probe do lock global | idem |

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

| Nome | Path / uso |
|------|------------|
| `nomus-orchestrator-global` | flock daily + SO shells (`/tmp/induscost-nomus-sync-global.lock`) |
| `nomus-sales-orders` | entity canonical SO |
| flock CR (shell) | `/tmp/induscost-nomus-accounts-receivable.lock` (`NOMUS_AR_SYNC_LOCK_FILE`) |
| canonical CR (TS) | `/tmp/induscost-nomus-accounts-receivable.canonical.lock` (`NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE`) |
| flock CP (shell) | `/tmp/induscost-nomus-accounts-payable.lock` (`NOMUS_AP_SYNC_LOCK_FILE`) |
| canonical CP (TS) | `/tmp/induscost-nomus-accounts-payable.canonical.lock` (`NOMUS_ACCOUNTS_PAYABLE_CANONICAL_LOCK_FILE`) |
| propostas (TS, PID+token) | `/tmp/induscost-nomus-proposals.lock` (`NOMUS_PROPOSALS_SYNC_LOCK_FILE`) — dentro de `nomusProposalsSyncV1.ts`; único ponto de entrada (CLI, orquestrador diário, cron horário), então um só lock basta |

OP-04: flock e lock canônico **não** compartilham pathname (evita autolock `SKIPPED_LOCKED`).
Colisão real (segunda execução da mesma entidade) → `SKIPPED_LOCKED` (não destrutivo).

Propostas segue o padrão mais recente (OP-11, Ordens de Produção): lock de
entidade PID+token (não mata processo vivo; PID morto é reclaimado) **e**
probe (não aquisição) do lock global diário/pedidos via
`probeGlobalNomusSyncLockHeld`. O runner diário (`runNomusDailySync.sh`) já
detém o lock global durante todo o pipeline — por isso ele exporta
`NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0` antes de chamar o passo de propostas,
evitando autolock; o cron horário roda com o default (`=1`, verifica).
Bloqueado por lock → sync devolve `status:"SKIPPED"` no JSON de stdout,
exit code 0 (não é falha), sem avançar nenhum estado. O orquestrador lê esse
campo e reporta o step como `SKIPPED` (não `SUCCESS`) no `IntegrationRun`.

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

## Propostas — rotina horária (SYNC-07)

Propostas **não tem arquitetura incremental** hoje (sem checkpoint/janela —
diferente de Documentos de Saída, que tem `checkpoint_overlap`). Cada
execução é um full scan das propostas Nomus, limitado apenas por
`NOMUS_PROPOSAL_START_DATE` (piso fixo, opcional) e `NOMUS_MAX_PAGES`. Rodar
de hora em hora repete esse full scan 24x/dia — mesmo comportamento do sync
diário, só que mais frequente; é o custo aceito para atender ao requisito de
quase-tempo-real. Não foi criado um motor incremental novo (fora de escopo:
"reutilize a implementação oficial"). Se o volume/latência da API Nomus virar
problema, considerar (fora deste ticket) ajustar `NOMUS_PROPOSAL_START_DATE`
para uma janela mais curta ou pedir suporte a filtro incremental no endpoint
`propostas` do Nomus.

Instalação no crontab do host:

```bash
37 * * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusProposalsHourlySync.sh apply >> /var/log/induscost-nomus-proposals-cron.log 2>&1
```

## Comandos manuais equivalentes

```bash
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:sales-orders:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-receivable:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-payable:apply
npm run sync:nomus:proposals:hourly:apply   # roda o runner horário localmente (log + orquestrador --only=proposals)
```

---

## Código

| Peça | Path |
|------|------|
| Contrato | `src/lib/nomus/nomusCanonicalSyncContract.ts` |
| Gateway | `src/lib/nomus/nomusCanonicalSync.server.ts` |
| Testes | `src/lib/nomus/nomusCanonicalSyncContract.test.ts` |
| Runbook lifecycle | `docs/nomus/nomus-source-reconciliation-runbook.md` |
| Propostas — constantes/lock | `src/lib/nomusProposalsSyncConstants.ts`, `src/lib/nomusProposalsSyncLock.ts` (+ `.test.ts`) |
| Propostas — script oficial (reusado) | `scripts/nomusProposalsSyncV1.ts` |
| Propostas — runner horário | `scripts/runNomusProposalsHourlySync.sh` |
