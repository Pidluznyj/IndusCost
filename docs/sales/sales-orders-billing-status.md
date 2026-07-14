# Coluna "Faturamento" — Pedidos de Venda

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Comercial → Pedidos de Venda (listagem operacional) |
| **Endpoint** | `GET /api/sales-orders` |
| **QA** | `npx tsx scripts/qaSalesOrdersBillingStatus.ts` |
| **Diagnóstico** | `npx tsx tmp-audits/inspect-sales-orders-billing-status.ts` |
| **Atualizado** | 2026-07-14 |

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

A regra oficial delega para o motor (`SalesOrderLinkedNfeContext`) o
cálculo de cobertura, que já respeita:

- Item cancelado no Nomus não conta como pendente para "parcial"
- Item com corte respeita o saldo ativo remanescente
- Coverage percent usa `INVOICE_COVERAGE_TOLERANCE_ABSOLUTE` +
  `INVOICE_COVERAGE_TOLERANCE_PERCENT` para tolerar arredondamentos

Portanto: um pedido com 2 itens onde item 1 foi cancelado no Nomus e item
2 foi faturado 100% aparece como **Faturado** (não como parcial).

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
