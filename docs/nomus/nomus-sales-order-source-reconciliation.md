# SYNC-04 — Reconciliação de lifecycle nos Pedidos de Venda

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-04 |
| **Pré-requisitos** | SYNC-01…03, OP-81 |
| **Atualizado** | 2026-07-17 |
| **Caso piloto** | PD 02739 / `externalSalesOrderId` 2737 |

---

## 0. Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | recent-window cobre universo completo? | **Não.** Nunca marca ausência / nunca incrementa `missingConsecutiveRuns`. |
| 2 | full-reconciliation prova completude? | **Só** com `startPage=1` + drain (`empty` \| `no_next`) + sem `maxPages` + sem erro/429 — mesma prova OP-81. Bloco com cursor ≠ completo. |
| 3 | OP-81 pode confirmar ausências? | **Sim** (read-only + `--confirm-candidates`). SYNC-04 reutiliza o auditor; `--lifecycle-preview` / `--lifecycle-apply` gravam só presença. |
| 4 | Syncer já tem consulta direcionada? | **Sim** (`fetchNomusPedidoByOrderCode` / `lookupNomusPedidoByOrderCode`). |
| 5 | Hooks pós-sync suportam reativação? | **Sim.** Pedido reaparecido entra em `affectedSalesOrderIds` e dispara os mesmos hooks de update (comissão, CRM owner, OP, flow). |

---

## 1. Modos

### RECENT-WINDOW (padrão prod)
- CREATE / UPDATE / PRESENT + `payloadHash`
- **Nunca** `MISSING_*`

### FULL-RECONCILIATION
- CREATE / UPDATE / REACTIVATE
- Ausência somente se coleta **COMPLETE** + flag `NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED`

### Consulta direcionada
- Confirma candidato específico (`DIRECTED_LOOKUP_NOT_FOUND`)
- Não altera outros pedidos

---

## 2. UPDATE real

Campos oficiais Nomus continuam sendo espelhados no syncer (código, cliente, vendedor Nomus, empresa, status, datas, pagamento, valores, frete, impostos, observações, itens, qty, preço comercial, status de itens, raw, `payloadHash`, vínculos NF seguros).

Preservados: custos/margem históricos do cabeçalho; regra de vendedor comissionável inalterada; sem delete físico (itens removidos → política stale existente).

---

## 3. Preview / apply

Saída `sourceLifecycle` no JSON do sync:

`creates`, `updates`, `unchanged`, `missingCandidates`, `missingConfirmed`, `reactivated`, `fetchCompleteness`, `ignoredOutsideScope`.

- Dry-run: não escreve
- Apply: transacional por pedido (upsert) + lote de patches de ausência
- Lock: `NOMUS_SALES_ORDERS_RECONCILE_LOCK_FILE` (default `/tmp/induscost-nomus-sales-orders-reconcile.lock`)

---

## 4. OP-81 (reutilizado)

```bash
# auditar (read-only)
npm run audit:nomus:sales-orders:orphans -- --from=2026-07-01 --to=2026-07-31

# confirmar candidato + preview lifecycle
npm run audit:nomus:sales-orders:orphans -- \
  --from=2026-07-01 --to=2026-07-31 \
  --orderCode="PD 02739" --confirm-candidates --lifecycle-preview

# aplicar somente lifecycle (flag env on + coleta COMPLETE)
npm run audit:nomus:sales-orders:orphans -- \
  --from=2026-07-01 --to=2026-07-31 \
  --confirm-candidates --lifecycle-apply
```

Não criar segundo auditor. Pedidos **não** são retirados das telas nesta etapa.

---

## 5. Código

| Peça | Path |
|------|------|
| Adapter puro | `src/lib/nomus/nomusSalesOrderSourceReconciliation.ts` |
| Persist/lock | `src/lib/nomus/nomusSalesOrderSourceReconciliation.server.ts` |
| Syncer | `scripts/nomusSalesOrdersSyncV1.ts` |
| OP-81 | `scripts/audit-nomus-sales-orders-orphans.ts` |
| Motor | `src/lib/nomus/nomusSourceReconciliationEngine.ts` |

```bash
npm run test:nomus:sales-orders-sync
npm run test:nomus:sales-orders-orphans
npm run test:nomus:source-lifecycle
npm run test:nomus:source-reconciliation
```
