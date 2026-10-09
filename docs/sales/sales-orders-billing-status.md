# Coluna "Faturamento" — Pedidos de Venda

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Comercial → Pedidos de Venda (listagem operacional) |
| **Endpoint** | `GET /api/sales-orders` |
| **QA** | `npx tsx scripts/qaSalesOrdersBillingStatus.ts` |
| **Diagnóstico** | `npx tsx tmp-audits/inspect-sales-orders-billing-status.ts` |
| **Atualizado** | 2026-10-09 (cobertura por item) |

## Objetivo

Substituir a coluna **Situação** (que mostrava status operacional bruto —
"Enviado ao Nomus", "Pronto para envio" etc.) por **Faturamento**, um sinal
comercial claro do que aconteceu com o pedido do ponto de vista do fisco/
cliente.

## Estados

| Valor | Label pt-BR | Regra | Cor |
|---|---|---|---|
| `INVOICED` | Faturado | NF vinculada cobrindo o valor líquido | verde |
| `PARTIALLY_INVOICED` | Parcialmente faturado | Há NF vinculada, mas cobertura < 100% | âmbar |
| `NOT_INVOICED` | Não faturado | Nenhuma NF vinculada | cinza |
| `CANCELED` | Cancelado | `SalesOrder.status === "CANCELLED"` | vermelho |

## Fonte oficial

- Motor de NF vinculada: `loadSalesOrderLinkedNfeContextMap`
  (`src/lib/salesOrderLinkedNfe.ts`), que consolida:
  - `SalesOrderNfeLink` (vínculos oficiais SalesOrder × NF-e)
  - `NomusNfe` (fatos NF-e do Nomus, quando presentes)
  - Fallback controlado: `nomusRawResponse.nfes[]` do pedido, quando o
    vínculo oficial ainda não materializou.
- Regra de decisão pura: `resolveSalesOrderBillingStatus`
  (`src/lib/sales/salesOrderListBillingStatus.ts`). Aceita apenas os flags
  já normalizados pelo motor oficial (`hasNfe`, `isFullyInvoiced`,
  `isPartiallyInvoiced`) — não recalcula cobertura no frontend.

O mesmo motor é usado por:
- Auditoria 360º do Pedido
- Conciliação de Carteira → Auditoria Pedido → Caixa
- Portfolio Reconciliation (allocation engine)

## O que NÃO conta como faturado

- **Contas a Receber planejado sem NF** — CR pode existir antes da NF ser
  emitida (previsto por condição de pagamento). Só a NF-e vinculada
  transforma o pedido em faturado.
- **Propostas** — não são fonte oficial do módulo de Pedidos de Venda.
- **`SalesOrder.status = "SENT_TO_NOMUS"`** — é status operacional
  (envio ao ERP), não é sinal de NF.
- **`hasInvoice` genérico** — mantido por compatibilidade no DTO
  (`SalesOrderListRowSnapshot.hasInvoice`), mas a UI e os relatórios usam
  `billingStatus` como fonte principal.

## Item cancelado / cortado

A intenção sempre foi: item cancelado no Nomus não conta como pendente e
corte respeita o saldo ativo. Um pedido com 2 itens onde item 1 foi
cancelado e item 2 foi faturado 100% é **Faturado** (não parcial).

Até 2026-10 isso não acontecia: a cobertura comparava a soma do cabeçalho
da NF (`xmlVNF`) com `SalesOrder.totalNetValue` original, o que gerava
falso "Parcialmente faturado" em três situações reais:

| Caso | Pedido | Motivo |
|---|---|---|
| NF com itens de vários pedidos | PD 02959 | cabeçalho 272.238 × pedido 107.508 |
| Itens cancelados | PD 02312, PD 02207 | `totalNetValue` inclui o valor cancelado |
| Frete / IPI na NF | PD 02123 | `vNF` 3.753,57 × pedido 3.513,57 |

## Cobertura por item (2026-10)

Duas perguntas separadas:

1. **Evidência fiscal** — existe NF-e válida vinculada? Sem mudança:
   `SalesOrderNfeLink` + `NomusNfe`, NF cancelada excluída. Sem NF válida o
   pedido nunca é faturado.
2. **Cobertura da obrigação** — os itens ativos estão integralmente
   faturados? `resolveItemizedBillingCoverage`
   (`src/lib/sales/salesOrderItemizedBillingCoverage.ts`) lê os
   `SalesOrderItemFlowSnapshot` do pedido: obrigação ativa =
   `shipTargetQuantity` (pedido − corte − cancelado) × `invoicedQuantity`.

| Cobertura por item | Status |
|---|---|
| `FULL` — todo item ativo com obrigação coberta | Faturado |
| `PARTIAL` — algum item faturado, não todos cobertos | Parcialmente faturado (*) |
| `NONE` — NF válida, nenhuma quantidade atribuída | regra por valor |
| `UNKNOWN` — sem snapshot, incompleto ou inconsistente | regra por valor |

(*) Se a NF é exclusiva do pedido e o valor fecha, o status por valor
(Faturado) prevalece e o motivo fica
`LEGACY_VALUE_FULL_OVER_ITEMIZED_PARTIAL` — o snapshot pode estar defasado.

`UNKNOWN` cobre: nenhum snapshot de item; contagem de snapshots diferente
da de `SalesOrderItem`; quantidade nula, negativa ou obrigação maior que o
pedido; pedido sem nenhuma obrigação ativa.

A regra por valor continua existindo como fallback e como métrica:
`invoiceCoveragePercent`, `nfeTotalValue`, `nfeProductsValue` e
`nfeHighlightedTaxesValue` não mudaram. O contexto expõe ainda
`legacyIsFullyInvoiced` / `legacyIsPartiallyInvoiced`,
`itemizedBillingCoverage`, `billingDecisionReason` e
`billingUsedLegacyFallback` para auditoria.

O Detalhe do Pedido passou a usar o mesmo contexto da grade (antes exibia
"Faturado" para qualquer pedido com NF).

Auditoria read-only (legado × por item × final × motivo):

```bash
npx tsx scripts/audit-sales-order-billing-status-vs-flow.ts --from=2026-01-01 --to=2026-10-31
```

## UI

### Tabela `SalesOrderListTable`

- Coluna 1: `Faturamento` — badge colorido + tooltip institucional
- Coluna 2: `NF` — número da última NF vinculada com contador `+N` para
  múltiplas NF-e. `—` quando não há NF.

Tooltip padronizado (constante exportada
`SALES_ORDER_BILLING_STATUS_TOOLTIP`):

> "Status calculado com base nas NF-e vinculadas ao pedido. Contas a
> Receber planejado sem NF não torna o pedido faturado."

### Relatórios (PDF + XLSX + Excel interno)

- **PDF branded** (`SalesOrderReportPrintDocument.tsx`): coluna
  "Faturamento" com cor por status (verde/âmbar/cinza/vermelho).
- **XLSX branded** (`salesOrderReportExport.ts`): coluna "Faturamento"
  logo após "Responsável operacional" e antes de "Status pedido"
  (mantido como coluna de auditoria interna).

## Filtros

A tela mantém o filtro **Status** legado (status operacional Nomus) por
compat. Um filtro dedicado "Faturamento" pode ser adicionado num segundo
momento, seguindo o padrão do enum `SalesOrderBillingStatus`.

## Endpoint

`GET /api/sales-orders` (server.ts) enriquece cada linha com:

```ts
billingStatus:       "INVOICED" | "PARTIALLY_INVOICED" | "NOT_INVOICED" | "CANCELED";
invoiceCount:        number;   // nfeCount do contexto oficial
lastInvoiceNumber:   string | null;
lastInvoiceDate:     string | null;   // ISO 8601 (processing ou emissão)
```

O DTO permanece backward-compatible (`hasInvoice` continua sendo emitido).

## Diagnóstico

Rodar contra base real:

```bash
npx tsx tmp-audits/inspect-sales-orders-billing-status.ts
npx tsx tmp-audits/inspect-sales-orders-billing-status.ts --orders=PD02739,PD02740,PD02719
```

Imprime, por pedido: `orderCode`, `oldStatus`, `hasInvoice`,
`invoiceCount`, `lastInvoiceNumber`, `activeOrderValue`, `invoicedValue`,
`invoiceCoveragePercent`, `billingStatus`, `billingStatusLabel`.

## QA

`scripts/qaSalesOrdersBillingStatus.ts` valida 10 asserções:

1. Regra pura → `INVOICED` para pedido com NF
2. Regra pura → `NOT_INVOICED` para pedido sem NF
3. Regra pura → `PARTIALLY_INVOICED` para cobertura parcial
4. Regra pura → `CANCELED` para `status="CANCELLED"`
5. UI da tabela usa "Faturamento" (sem "Situação"/"Enviado ao Nomus")
6. Filtro por Cliente + botão Limpar filtros preservados
7. XLSX emite coluna "Faturamento" a partir de `row.billingStatusLabel`
8. PDF emite header "Faturamento" + célula `row.billingStatusLabel`
9. Regra oficial não referencia Proposta/CR
10. Frontend não importa `@prisma/client`

Sair com exit code `0` = liberação para deploy.
