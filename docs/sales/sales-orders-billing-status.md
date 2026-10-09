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
| `FULL` — todo item com obrigação ativa coberto; ou nenhum item com obrigação ativa e ao menos um com quantidade faturada | Faturado |
| `PARTIAL` — algum item faturado, não todos cobertos | Parcialmente faturado |
| `NONE` — NF válida, nenhuma quantidade atribuída aos itens | regra por valor (`ITEMIZED_NONE_FALLBACK_VALUE`) |
| `UNKNOWN` — sem snapshot, incompleto, inconsistente ou defasado | regra por valor (`ITEMIZED_UNKNOWN_FALLBACK_VALUE`) |

A regra por valor nunca sobrepõe `FULL` nem `PARTIAL`: um `PARTIAL` vale
mesmo que o valor da NF feche com o pedido. `NONE` é inconclusivo para o
status ("parcial" exige alguma cobertura > 0) e usa a regra por valor, com
motivo distinto de `UNKNOWN`.

`UNKNOWN` cobre: nenhum snapshot de item; contagem de snapshots diferente
da de `SalesOrderItem`; quantidade nula, negativa ou obrigação maior que o
pedido; `computedAt` ausente; pedido sem obrigação ativa e sem nenhuma
quantidade faturada (só corte/cancelamento); e
snapshot defasado (abaixo).

### Item sem obrigação ativa (corte)

Em `FULFILLED_WITH_CUT` o motor pode gravar `cutQuantity` igual à quantidade
pedida mesmo quando parte foi faturada (PD 02231: pedido 50.000, faturado
26.000, corte 50.000, saldo ativo 0). Por isso a regra não exige
`invoicedQuantity == orderedQuantity` nem soma faturado + corte: usa a
obrigação ativa normalizada pelo motor (`shipTargetQuantity` e
`activeRemainingQuantity`).

- Item com obrigação ativa > 0: faturado × obrigação ativa.
- Item com obrigação ativa 0 e saldo ativo 0: não gera pendência; com
  quantidade faturada conta como resolvido com cobertura.
- Nenhum item com obrigação ativa e ao menos um resolvido com cobertura →
  `FULL` (`NO_ACTIVE_OBLIGATION_WITH_INVOICE_COVERAGE`).
- Só itens cortados/cancelados sem quantidade faturada → `UNKNOWN`
  (`NO_ACTIVE_OBLIGATION`), regra por valor.
- Item resolvido com cobertura + item com obrigação ativa pendente → `PARTIAL`.
- Obrigação ativa 0 com saldo ativo positivo ou ausente → inconsistente.

### Frescor do snapshot

A cobertura por item só é autoridade quando todos os snapshots do pedido
foram gravados depois da evidência fiscal mais recente:

```
min(SalesOrderItemFlowSnapshot.computedAt)
  >= max(SalesOrderNfeLink.firstSeenAt, data de processamento) das NF válidas
```

- `firstSeenAt` é gravado uma única vez, quando o vínculo pedido × NF é
  criado. `lastSeenAt` / `updatedAt` do vínculo e `syncedAt` / `updatedAt`
  de `NomusNfe` são reescritos a cada sync e não servem para frescor.
- Snapshot anterior → `ITEM_SNAPSHOT_STALE`; vínculo sem `firstSeenAt` →
  `ITEM_SNAPSHOT_FRESHNESS_UNVERIFIABLE`. Ambos caem na regra por valor.

Limitações conhecidas (sem migration):

- O recompute só regrava o snapshot quando o resultado muda (fingerprint);
  `computedAt` é "última mudança", não "última verificação". A checagem
  nunca aceita snapshot anterior à NF, mas pode recusar um snapshot que já
  continha a quantidade — por exemplo, Documento de Saída sincronizado
  antes de o vínculo da NF ser criado, ou vínculos criados por backfill.
  Esses pedidos ficam na regra por valor.
- Não há timestamp confiável para mudança de status da NF (cancelamento)
  nem para falha do recompute após o sync. NF cancelada sai da evidência
  fiscal pelo status, mas um snapshot que ainda conta a quantidade dela não
  é detectável só pelos dados lidos.
- Um campo `verifiedAt` no snapshot, atualizado a cada recompute, resolveria
  os dois pontos; exige migration e ficou fora desta entrega.

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
