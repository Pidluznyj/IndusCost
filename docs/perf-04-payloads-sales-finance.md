# PERFORMANCE 04 — Redução de payloads (Pedidos + Financeiro)

Sem migration. Sem alteração de regra de negócio, layout, filtros, totais ou permissões.

## Auditoria (resumo)

| Endpoint | Antes | Uso real | Ação |
|----------|-------|----------|------|
| `GET /api/sales-orders` | Spread Prisma + `Customer: true` + summary com `SALES_ORDER_RULES_PRISMA_SELECT` (incl. `nomusRawResponse`/items) | Grade usa snapshot magro + margem/faturamento | **DTO + select** |
| `GET /api/sales-orders/:id` | `include` Product/Proposal/ProposalItem + Customer completo + raw | Print + drawer margem | **select slim + DTO** (detalhe oficial = `/detail`) |
| `GET /api/sales-orders/results` | HTTP já agregado | Gráficos | Sem mudança HTTP |
| `GET /api/finance/billing/nfes` | Já sem `xmlRaw` no select principal | Lista Documentos | Confirmado (já otimizado) |
| AR/AP titles / overdue / due-radar | Selects sem `rawPayload` | Grids usam colunas | Sem remoção segura adicional |
| CF daily-radar | `selectedDay` duplica `selectedDetail`; payable tem campos de auditoria | UI usa `selectedDetail` + status/paymentMethod | Mantido por contrato/testes |

## Endpoints otimizados

1. **`GET /api/sales-orders`**
2. **`GET /api/sales-orders/:id`** (legado)

## Campos removidos do HTTP

### Listagem `GET /api/sales-orders`

- `nomusRawResponse` (permanece no select Prisma da página só para NF/margem server-side)
- Sync/presença: `payloadHash`, `sourcePresenceStatus`, `presentInLastPayload`, `firstSeenAt`, `lastSeenAt`, `missingSince`, `missingConsecutiveRuns`, `sourceRemovedAt`, `lastSyncRunId`
- Detalhe comercial: `notes`, `internalNotes`, `paymentTerms`, `paymentMethod`, `freightCondition`, `deliveryLocation`, totais brutos/custo/imposto/frete, `sentToNomusAt`
- Customer além de `companyName` / `tradeName`

**Preservados:** id, orderCode, status, datas, totais líquidos/itens, seller, responsible, billing/NF, Proposal subset, marginSummary/marginItems, paginação, summary, marginSummary agregado.

### Detalhe legado `GET /api/sales-orders/:id`

- `nomusRawResponse` (HTTP)
- Relações `Product`, `Proposal`, `ProposalItem`
- Customer reduzido aos campos de impressão (nome, taxId, endereço, telefone)

**Preservados:** cabeçalho comercial da impressão, itens com snapshots, `margin` por item, `marginSummary`.

## Includes → select

| Local | Antes | Depois |
|-------|-------|--------|
| List page | `include: { Customer: true, Proposal: {…} }` | `SALES_ORDER_LIST_PAGE_PRISMA_SELECT` |
| List summary | `SALES_ORDER_RULES_PRISMA_SELECT` (pesado) | `SALES_ORDER_LIST_SUMMARY_PRISMA_SELECT` (`totalNetValue`, `totalItems`) |
| Legacy detail | `include` aninhado Product/Proposal | `SALES_ORDER_LEGACY_DETAIL_PRISMA_SELECT` |

## Separação lista/detalhe

- Lista não serializa detalhe/raw.
- Detalhe oficial continua em `/api/sales-orders/:id/detail`.
- `:id` legado slim para print/drawer — sem nova chamada na UX da lista.

## DTOs

- `src/lib/salesOrderListApiDto.ts` — `toSalesOrderListHttpRow`
- `src/lib/salesOrderLegacyDetailApiDto.ts` — `toSalesOrderLegacyDetailHttpRow`

## Testes

```bash
npx tsx --test src/lib/salesOrderListApiDto.test.ts src/lib/financeBillingNfeList.test.ts
```

## Métricas (estimativa estrutural; DB local PENDING)

| Endpoint | Antes (estrutura) | Depois | Redução esperada |
|----------|-------------------|--------|------------------|
| `/api/sales-orders` (por linha) | Linha Prisma completa + Customer full + JSON Nomus | ~20 campos + Customer 2 campos | **Alto** (JSON Nomus costuma dominar) |
| `/api/sales-orders` summary query | Rules select + items + raw | 2 scalars | **Alto** (DB transfer) |
| `/api/sales-orders/:id` | Product+Proposal+Item+raw | Snapshots + Customer slim | **Médio–alto** |
| `/api/finance/billing/nfes` | Já limpo | Igual | 0 (já otimizado) |

Reexecutar baseline quando Postgres disponível:

```bash
$env:INDUSCOST_PERF_BASELINE='1'
npm run perf:baseline:sales-finance
```

## Confirmações

- Resultados funcionais da listagem/impressão/margem preservados (mesmos campos de UI)
- Nenhum commit / push / deploy neste passo
