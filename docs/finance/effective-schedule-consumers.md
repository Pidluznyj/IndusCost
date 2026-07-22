# FIN-09 — Consumidores da agenda financeira efetiva

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | FIN-09 |
| **Atualizado** | 2026-07-17 |
| **Motor canônico** | `src/lib/finance/salesOrderEffectiveFinancialSchedule.ts` (FIN-05) |
| **Política** | `docs/finance/effective-schedule-policy.md` (FIN-02) |
| **Inventário prévio** | `docs/finance/effective-schedule-current-flow.md` (FIN-01) |

Este documento lista os consumidores que **devem** ler a agenda efetiva (FIN-05) e o estado de migração após FIN-09.

---

## 1. Regras operacionais (checklist)

| Regra | Comportamento |
|---|---|
| Previsão substituída | Não gera alerta de vencimento / cobrança |
| Valor cortado | Não gera alerta financeiro de aberto/vencido |
| Previsão residual vencida | Pode gerar `PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR` |
| Documento sem CR e sem agenda comprovada | `DOCUMENT_AWAITING_FINANCIAL_SCHEDULE` |
| Status UNKNOWN com residual | `ITEM_CLASSIFICATION_PENDING` — não zerar silenciosamente |
| CR + Documento mesma cadeia | Não somar; CR prevalece / max na evidência |
| Contas a Pagar (AP) | **Não alterar** regras oficiais |
| Comissões pagas | **Não alterar** |
| Valores oficiais do AR (Nomus) | **Não alterar** títulos; só complementar residual/contexto |

---

## 2. Consumidores migrados / alinhados

| # | Consumidor | Entrada | Motor | Estado FIN-09 |
|---|---|---|---|---|
| 1 | **Detalhe do Pedido** (cards, tabela, impressão/PDF) | `getSalesOrderDetail` → `buildSalesOrderDetailFinancialFromAudit` | FIN-05 | Migrado (FIN-06/07) |
| 2 | **Alertas financeiros** (previsão vencida, Pedido sem CR, divergência vencimento, aguardando, UNKNOWN) | `buildEffectiveScheduleConsumerAlerts` via Auditoria 360° | FIN-05 | Migrado |
| 3 | **Auditoria 360°** — aba Financeiro / plannedReceivables | `projectEffectiveScheduleForOrderAudit` em `orderFullAuditService` | FIN-05 | Migrado |
| 4 | **Contas a Receber** (filtro Pedido/cliente) | `financeAccountsReceivableEffectiveTitles` + routes | FIN-05 | Migrado (FIN-08) |
| 5 | **Resolver por pedido** | `resolveReceivablesForSalesOrder` | FIN-05 | Migrado (FIN-08/09) |
| 6 | **Cards / consolidação comercial** | `computeConsolidatedFinancialSummary` com `applicableExpected` FIN-05 | FIN-05 (via planned totals do audit) | Alinhado |
| 7 | **Documentos de Saída** — evidência financeira | `resolveFinancialEvidenceWithoutDoubleCount` | max(CR, Doc) + residual pedido | Alinhado (sem soma CR+Doc) |
| 8 | **Fluxo de Caixa oficial** | `financeCashFlowDataset` + `financeCashFlowEffectiveAr` | FIN-05/FIN-08 | Migrado — portfólio AR com agenda efetiva quando há pedidos no lote |
| 9 | **Impressão/PDF Detalhe** | mesma payload FIN-05 do Detalhe | FIN-05 | Migrado |
| 10 | **Impressão títulos AR** | linhas com `lineKind` quando contextualizado | FIN-05 (FIN-08) | Alinhado |

---

## 3. Consumidores fora de escopo / deliberadamente intactos

| Consumidor | Motivo |
|---|---|
| Contas a Pagar (AP) | Fora do escopo FIN; regras oficiais preservadas |
| Comissões pagas / ledger | Eixo próprio Nomus; não inventar residual paralelo |
| AR geral sem filtro Pedido/cliente | Continua Nomus-only (valores oficiais); enriquecimento só com contexto |
| Portfolio cash-forecast maturity | Maturidade comercial paralela; não altera Fluxo de Caixa oficial |
| Listagem comercial Motor D (`resolveSalesOrderListPaymentSummary` com receivables) | Export de condição de pagamento; quando há CR, linhas do título substituem forecast — **não soma** CR+previsão |
| O2C `plannedReceivableValue` no fact | Campo operacional de rebuild; não é total de Contas a Receber |

---

## 4. Códigos de alerta (contrato FIN-09)

| Código | Quando |
|---|---|
| `PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR` | Residual ativo vencido |
| `PLANNED_RECEIVABLE_WITHOUT_REAL_CR` | Residual ativo ainda sem CR (a vencer / vence hoje) |
| `PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR` | Info — previsão substituída (não cobrança) |
| `PLANNED_VS_CR_DUE_DATE_DIVERGENCE` | Info — datas da previsão original ≠ CR vigente |
| `DOCUMENT_AWAITING_FINANCIAL_SCHEDULE` | Documento cobrindo valor sem condição comprovada e sem CR |
| `ITEM_CLASSIFICATION_PENDING` | Item UNKNOWN com residual provisório |
| `ORDER_ITEM_CUT` | Info de item — **não** alerta de saldo financeiro aberto |

---

## 5. Arquivos-chave

| Papel | Path |
|---|---|
| Motor | `src/lib/finance/salesOrderEffectiveFinancialSchedule.ts` |
| Projeção audit/alertas | `src/lib/finance/effectiveScheduleAuditProjection.ts` |
| Detalhe Pedido | `src/lib/sales-orders/salesOrderDetailEffectiveFinancial.ts` |
| Contas a Receber | `src/lib/finance/financeAccountsReceivableEffectiveTitles.ts` |
| Auditoria 360° | `src/lib/finance/orderFullAuditService.ts` |
| Testes regressão consumidores | `src/lib/finance/effectiveScheduleConsumers.test.ts` |

---

## 6. Como validar

```bash
npx tsx --test src/lib/finance/effectiveScheduleConsumers.test.ts
npx tsx --test src/lib/finance/salesOrderEffectiveFinancialSchedule.test.ts
npx tsx --test src/lib/sales-orders/salesOrderDetailEffectiveFinancial.test.ts
npx tsx --test src/lib/finance/financeAccountsReceivableEffectiveTitles.test.ts
```

Critérios: residual vencido alerta; substituída/corte não alertam como aberto; Documento aguardando tem código próprio; CR não soma com Documento; Fluxo de Caixa sem import do motor de previsão do Pedido.
