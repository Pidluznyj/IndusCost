# OP-16 — API IndusCost read-only: listagem de Ordens de Produção

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Endpoint** | `GET /api/operations/production-orders` · `GET /api/operations/production-orders/:id` |
| **Status** | Implementado (OP-16 listagem · OP-17 detalhe) |
| **Fonte de dados** | PostgreSQL local — **sem** chamada Nomus |

Documentos irmãos:

- [`ui-architecture-audit.md`](./ui-architecture-audit.md) — arquitetura da tela
- [`api-contract.md`](./api-contract.md) — contrato Nomus `/rest/ordens` (sync)
- [`operations.md`](./operations.md) — sync/backfill CLI

---

## 1. Autenticação e permissão

| Campo | Valor |
|-------|-------|
| Auth | Sessão app (`requireAppAuth`) |
| resourceKey | `operations.production_orders` |
| action | `view` |
| Legacy permission | `operations.production-orders.view` |

Respostas de erro:

| HTTP | code | Quando |
|------|------|--------|
| 401 | `UNAUTHORIZED` | Sem sessão |
| 403 | — | Sem permissão |
| 400 | `INVALID_PAGE` | `page` inválido |
| 400 | `INVALID_PAGE_SIZE` | `pageSize` inválido ou acima do teto |
| 400 | `INVALID_FROM` / `INVALID_TO` | Data ISO inválida |
| 400 | `INVALID_DATE_RANGE` | `from` > `to` |
| 400 | `INVALID_ID` | `:id` não é UUID válido (detalhe) |
| 404 | `NOT_FOUND` | OP inexistente (detalhe) |
| 500 | `INTERNAL_ERROR` | Erro inesperado |

---

## 2. Query params

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `page` | int ≥ 1 | `1` | Página |
| `pageSize` | int ≥ 1 | `50` | Tamanho (máx. **200**) |
| `search` | string | — | Busca case-insensitive em `name`, `productCode`, `productDescription`, `salesLinks.customerName`, `SalesOrder.orderCode` |
| `status` | string | — | Igualdade exata em `NomusProductionOrder.status` |
| `tipo` | string | — | Igualdade exata em `tipo` |
| `company` | string | — | `contains` case-insensitive em `companyName` |
| `from` | ISO date | — | Início do período em **`openedAt`** (inclusive) |
| `to` | ISO date | — | Fim do período em **`openedAt`** (inclusive) |

### Eixo do período

Campo oficial: **`openedAt`** (`NomusProductionOrder.openedAt` ← `dataAbertura` Nomus).

Documentado em código: `PRODUCTION_ORDERS_LIST_PERIOD_FIELD = "openedAt"`.

Não inferir datas ausentes. OP com `openedAt = null` **não** entra em filtros `from`/`to`.

---

## 3. Ordenação

Fixa (não parametrizável na v1):

1. `openedAt` **desc**
2. `externalId` **desc** (desempate)

---

## 4. Resposta

```json
{
  "rows": [],
  "page": 1,
  "pageSize": 50,
  "total": 0,
  "totalPages": 1,
  "statusCounts": {
    "Encerrada": 12,
    "": 1
  },
  "appliedFilters": [
    { "key": "search", "label": "Busca", "value": "05800" }
  ],
  "periodField": "openedAt"
}
```

### 4.1 Linha (`rows[]`)

| Campo | Tipo | Origem |
|-------|------|--------|
| `id` | uuid | `NomusProductionOrder.id` |
| `externalId` | int | `externalId` |
| `name` | string \| null | `name` |
| `status` | string \| null | `status` (literal Nomus) |
| `tipo` | string \| null | `tipo` |
| `priority` | string \| null | `priority` |
| `companyName` | string \| null | `companyName` (empresa emissora) |
| `productCode` | string \| null | `productCode` |
| `productDescription` | string \| null | `productDescription` |
| `quantity` | string \| null | `quantity` serializado (`Decimal` → string; **null permanece null**) |
| `unit` | string \| null | `unit` |
| `stockSector` | string \| null | `stockSector` |
| `openedAt` | ISO \| null | `openedAt` |
| `plannedAt` | ISO \| null | `plannedAt` |
| `closedAt` | ISO \| null | `closedAt` |
| `nomusUpdatedAt` | ISO \| null | `nomusUpdatedAt` |
| `syncedAt` | ISO \| null | `syncedAt` |
| `currentLinkCount` | int | vínculos com `isCurrent=true` |
| `currentSalesOrders` | array | resumo deduplicado por `externalSalesOrderId` |
| `hasPendingLink` | boolean | vínculo atual com `salesOrderId` ou `salesOrderItemId` null |

#### `currentSalesOrders[]`

| Campo | Tipo |
|-------|------|
| `externalSalesOrderId` | int |
| `orderCode` | string \| null |
| `customerName` | string \| null |

### 4.2 `statusCounts`

Contagem por valor **real** de `status` no banco, respeitando os mesmos filtros da listagem (exceto paginação).

- Chave `""` (string vazia) = registros com `status IS NULL`.
- Sem enum inventado.

---

## 5. Arquitetura de consulta (sem N+1)

Por request:

1. `findMany` cabeçalhos OP (select mínimo, `skip`/`take`)
2. `count` total
3. `groupBy status` para `statusCounts`
4. **Uma** query batch em `NomusProductionOrderSalesLink` para os IDs da página

Implementação: `src/lib/productionOrdersList.server.ts`.

---

## 6. Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/lib/productionOrdersListQuery.ts` | Parser/validação query |
| `src/lib/productionOrdersList.ts` | Where, serialização, agregação links |
| `src/lib/productionOrdersList.server.ts` | Orquestração Prisma |
| `src/lib/productionOrdersRoutes.ts` | Registro Express |
| `src/lib/productionOrdersList.test.ts` | Testes |

Testes: `npm run test:production-orders-api` ou inclusão em `test:nomus:production-orders`.

---

## 7. Detalhe — `GET /api/operations/production-orders/:id` (OP-17)

### 7.1 Identificador

- `:id` = **UUID interno** (`NomusProductionOrder.id`) retornado pelo grid.
- **Não** aceita `externalId`, nome textual ou código Nomus.

### 7.2 Resposta

```json
{
  "identification": { "id", "externalId", "name", "status", "tipo", "priority" },
  "product": {
    "externalProductId", "productCode", "productDescription", "productAdditionalInfo",
    "productConfigId", "productConfigCode", "quantity", "unit", "stockSector"
  },
  "company": { "externalCompanyId", "companyName" },
  "dates": {
    "openedAt", "plannedAt", "closedAt", "nomusUpdatedAt",
    "firstSeenAt", "lastSeenAt", "lastChangedAt", "syncedAt", "createdAt", "updatedAt"
  },
  "salesLinks": [/* ver abaixo */],
  "auditSummary": {
    "currentLinkCount", "removedLinkCount", "resolvedLinkCount", "pendingLinkCount"
  },
  "rawJson": { /* payload Nomus sanitizado */ }
}
```

Valores `null` permanecem `null`. Decimais serializados como string.

### 7.3 Vínculos (`salesLinks[]`)

| Campo | Descrição |
|-------|-----------|
| `linkState` | `current_resolved` \| `current_pending` \| `removed` |
| `isCurrent` | Flag persistida |
| `externalSalesOrderId` | ID Nomus pedido |
| `externalSalesOrderItemId` | ID Nomus item |
| `itemNumber` | Sequência Nomus |
| `customerName` | Denormalizado do payload |
| `linkedQuantity` | Quantidade do vínculo |
| `salesOrderId` / `salesOrderItemId` | FKs locais (null = pendente) |
| `orderCode` | `SalesOrder.orderCode` quando resolvido |
| `localItem` | Dados mínimos do `SalesOrderItem` ou `null` |
| `firstSeenAt` / `lastSeenAt` / `removedAt` | Metadados sync |
| `rawJson` | Item `itensPedido` sanitizado ou `null` |

**Estados:**

- **Atual resolvido:** `isCurrent=true` + FKs locais preenchidas.
- **Pendente:** `isCurrent=true` + FK local ausente.
- **Removido:** `isCurrent=false` — **não ocultado** na resposta.
- **Reativado:** volta a `current_*` conforme FKs; histórico removido permanece na lista.

Relações **somente** por IDs oficiais Nomus já persistidos — sem inferência por cliente/produto/quantidade.

### 7.4 `auditSummary`

| Campo | Regra |
|-------|-------|
| `currentLinkCount` | `isCurrent === true` |
| `removedLinkCount` | `isCurrent === false` |
| `resolvedLinkCount` | `salesOrderId` e `salesOrderItemId` preenchidos (qualquer estado) |
| `pendingLinkCount` | `isCurrent === true` e FK local incompleta |

### 7.5 Segurança do payload

`rawJson` (OP e vínculos) passa por `sanitizeProductionOrderRawJson`:

- Redige chaves sensíveis (`authorization`, `token`, `NOMUS_TOKEN`, etc.).
- Remove padrões Bearer/Basic em strings.
- **Não** chama Nomus; **não** muta banco.

### 7.6 Consulta (sem N+1)

Uma única `findUnique` com `include.salesLinks` + joins `SalesOrder` / `SalesOrderItem`.

Implementação: `src/lib/productionOrdersDetail.server.ts`.

### 7.7 Arquivos

| Arquivo | Papel |
|---------|-------|
| `src/lib/productionOrdersDetail.ts` | Tipos, serialização, sanitização, audit |
| `src/lib/productionOrdersDetail.server.ts` | Prisma read |
| `src/lib/productionOrdersDetail.test.ts` | Testes |

---

## 8. Próximo prompt (OP-18+)

- Menu `/production-orders` + UI grid + drawer
