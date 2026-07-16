# Ordens de Produção Nomus — Release Candidate (OP-14)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Regressão final OP-01…OP-13 — sem UI / operações / reportes / movimentações |
| **Data** | 2026-07-16 |
| **Status** | **RC aprovado em testes locais** (migration live bloqueada: Postgres `localhost:5432` inacessível neste ambiente) |

Commits auditados (ordem):

| Prompt | Commit | Mensagem |
|--------|--------|----------|
| OP-01 | `069d5f2` | docs: map Nomus production order integration |
| OP-02 | `92522f1` | feat: add Nomus production order schema |
| OP-03 | `cb67564` | feat: add Nomus production order parsers |
| OP-04 | `747075d` | feat: add Nomus production order API client |
| OP-05 | `26dd335` | feat: persist Nomus production orders |
| OP-06 | `0630caa` | feat: link production orders to sales order items |
| OP-07 | `172850a` | feat: add production order sync preview |
| OP-08 | `bcb3917` | feat: add production order backfill |
| OP-09 | `cf43dc8` | feat: add incremental production order sync |
| OP-10 | `1624569` | feat: add production order lookup and reconciliation |
| OP-11 | `13ebddf` | feat: add production order sync locking and audit |
| OP-12 | `4a58a51` | docs: add production order sync operations |
| OP-13 | `1d72714` | feat: sync production orders after sales orders |

Documentos: [`operations.md`](./operations.md) · [`api-contract.md`](./api-contract.md) · [`../integrations/nomus-production-orders-sync.md`](../integrations/nomus-production-orders-sync.md)

---

## 1. Isolamento de domínio (não regressão)

Diff OP-01…OP-13 **não** altera regras oficiais de:

| Domínio | Evidência |
|---------|-----------|
| Pedido de Venda | Única mudança em `nomusSalesOrdersSyncV1.ts`: hook soft-fail pós-apply → OP incremental (não muta payload/pedido) |
| NF-e / Documento de Saída | Sem diff nos syncs NF-e / stock documents |
| AR / AP / Fluxo | Sem diff |
| Comissões | Hook de comissão pré-existente preservado; OP não o altera |
| Precificação / BOM / Relatório Presidencial | Sem diff |

Models OP só **referenciam** `SalesOrder` / `SalesOrderItem` com `ON DELETE SET NULL` — não reescrevem linhas de negócio.

---

## 2. Matriz de regressão (requisitos 1–20)

| # | Requisito | Status | Evidência | Teste |
|---|-----------|--------|-----------|-------|
| 1 | Schema aditivo | OK | `NomusProductionOrder` + `SalesLink` no schema; sem SyncState | `nomusProductionOrders.test.ts` wiring schema |
| 2 | Migration segura | OK* | `20260728120000` CREATE; `20260728140000` ADD/RENAME IF EXISTS | SQL review + `prisma validate` (*deploy live: DB offline) |
| 3 | Parser decimal | OK | `"15.400"→15400`; `"0,002925"→0.002925` | `nomusProductionOrdersParsers.test.ts` |
| 4 | Parser de datas | OK | `dd/MM/yyyy HH:mm:ss` America/Sao_Paulo | idem |
| 5 | Cliente API | OK | `NomusProductionOrdersClient` + `nomusRestClient` | `nomusProductionOrdersClient.test.ts` |
| 6 | Paginação | OK | `pagina`/`tamanhoPagina`; stop empty/max | client + syncLogic tests |
| 7 | Rate limit | OK | 429 + `tempoAteLiberar`; contagem | client HTTP 429; backfill rateLimit |
| 8 | Persistência | OK | upsert por `externalId`; tx pequena | `nomusProductionOrdersPersist.test.ts` |
| 9 | Hash / idempotência | OK | `payloadHash` estável; 2ª exec unchanged | persist + parsers hash tests |
| 10 | Vínculos pedido | OK | `idPedido`/`id` oficiais | salesLinks + fixture 05800 |
| 11 | Vínculos pendentes | OK | FK null até pedido local | salesLinks reconcilePending |
| 12 | Vínculos removidos | OK | `isCurrent=false` + `removedAt` | salesLinks removido/reativado |
| 13 | Preview | OK | DRY RUN sem escrita | `nomusProductionOrdersPreview.test.ts` |
| 14 | Backfill | OK | checkpoint; não no orquestrador | `nomusProductionOrdersBackfill.test.ts` |
| 15 | Incremental | OK | overlap 72h; estado só em sucesso | `nomusProductionOrdersIncremental.test.ts` |
| 16 | Consulta pontual | OK | name/id/pedido/item | `nomusProductionOrdersLookup.test.ts` |
| 17 | Reconciliação | OK | DB-only; sem mutar SalesOrder | lookup reconcile + salesLinks |
| 18 | Locks | OK | lock compartilhado; BLOCKED exit 0 | `nomusProductionOrdersSyncLock.test.ts` |
| 19 | Logs | OK | `[nomus-production-orders]`; mask token | syncAudit / lock tests |
| 20 | Encadeamento pós Sales Orders | OK | incremental 1×; soft-fail | `nomusProductionOrdersAfterSalesOrders.test.ts` |

### Casos obrigatórios

| Caso | Status | Teste |
|------|--------|-------|
| `"15.400"` → 15400 | OK | parsers |
| `"0,002925"` → 0.002925 | OK | parsers |
| OP sem pedido | OK | mapper sem itensPedido |
| OP com um item | OK | fixture 05800 |
| OP com vários itens | OK | salesLinks vários vínculos |
| várias OPs mesmo item | OK | salesLinks |
| status alterado | OK | persist |
| quantidade alterada | OK | persist |
| vínculo removido / reativado | OK | salesLinks |
| pedido ainda não sync / depois | OK | pending + reconcilePending |
| HTTP 429 / 500 / timeout | OK | client |
| página repetida | OK | client + backfill |
| preview sem escrita | OK | preview |
| 2ª execução sem duplicidade | OK | persist / lookup / backfill |
| OP 05800 - 003 / 30347 / 2530 / 11324 / PD 02534 | OK | fixture + expected.salesOrderCode |

---

## 3. Checks executados (OP-14)

| Check | Resultado |
|-------|-----------|
| `npx prisma format` | OK |
| `npx prisma validate` | OK |
| `npm run test:nomus:production-orders` | **125 pass** |
| `npm run check:frontend-server-imports` | OK |
| `npm run check:server-imports` | OK |
| `npm run check:browser-bundle` | OK |
| `npm test` | **OK** (exit 0) |
| `npm run build` | **OK** (`✓ built`) |
| `npx prisma migrate deploy` em `induscost_validate` | **BLOQUEADO** — `P1001` localhost:5432 offline |
| Correção colateral | Teste portfolio (P17): AR não concede conciliação — alinhado ao contrato |

Validação estática de migration (substituto quando DB offline):

- Migrations OP só criam/alteram `NomusProductionOrder*`.
- FKs para SalesOrder/Item são nullable + `ON DELETE SET NULL`.
- Comentários SQL: “Aditivo e retrocompatível. Não altera tabelas de Pedido…”.

---

## 4. Roteiro de deploy (servidor — não executar daqui)

1. Checar sync ativo (locks global/OP livres).
2. Backup Postgres.
3. `npx prisma migrate deploy` (migrations OP aditivas).
4. `npx prisma generate`.
5. Build + restart do serviço.
6. Smoke: `lookup:preview --name="OP 05800 - 003"`.
7. `incremental:preview` → `incremental:apply` (overlap 72h).
8. Confirmar IntegrationRun `target=production-orders`.
9. Confirmar pós-pedidos: após `sales-orders:apply`, log `production-orders: incremental`.
10. Idempotência: 2ª incremental sem duplicar.
11. Rollback plan pronto (abaixo).

---

## 5. Roteiro de backfill (manual only)

```bash
npm run sync:nomus:production-orders:backfill:preview -- --max-pages=5
npm run sync:nomus:production-orders:backfill:apply -- --cursor-file=/tmp/op-backfill.cursor --max-pages=20
```

- **Nunca** via cron/orquestrador/pós-pedidos.
- Respeitar lock; SIGINT entre páginas.
- Monitorar 429 / `rateLimitCount`.

---

## 6. Roteiro de validação (pós-deploy)

```bash
npm run test:nomus:production-orders
npm run sync:nomus:production-orders:lookup:preview -- --external-id=30347
npm run sync:nomus:production-orders:lookup:preview -- --name="OP 05800 - 003"
npm run sync:nomus:production-orders:reconcile
# após um apply de pedidos de teste:
# log deve conter production-orders: incremental (ou BLOCKED/skipped)
```

Critérios: vínculo 2530/11324; sem duplicate `externalId`; preview sem escrita; lock concorrente → BLOCKED exit 0.

---

## 7. Rollback

1. Parar runners OP / não matar mid-page (SIGINT backfill).
2. Desligar pós-pedidos: `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC=false`.
3. Restaurar backup se dados stage corrompidos.
4. Migrations OP **não** dropam Pedido/NF-e/AR — rollback de schema só com plano DBA (`migrate resolve` / down manual das duas migrations OP).
5. Cursor/estado incremental: restaurar arquivos do backup ou bootstrap com overlap maior.
6. Revalidar preview antes de reabilitar pós-pedidos.

---

## 8. Fora de escopo (confirmado)

- Tela de Ordens de Produção
- Operações / reportes / movimentações de estoque
- Alterar regras de comissão, precificação, BOM, Relatório Presidencial
