# Integração oficial — Ordens de Produção Nomus (`/rest/ordens`)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Endpoint** | `GET /rest/ordens` |
| **Status** | Stage local oficial (v1) — sync script + pós Pedidos de Venda |
| **Data** | 2026-07-16 |

> Descoberta prévia: [`nomus-production-orders-api-discovery.md`](./nomus-production-orders-api-discovery.md)

---

## 1. Objetivo

Persistir Ordens de Produção do Nomus no IndusCost com vínculo **oficial** a Pedido de Venda e item:

| Campo Nomus (`itensPedido[]`) | Destino IndusCost |
|-------------------------------|-------------------|
| `idPedido` | `SalesOrder.externalSalesOrderId` / link `externalSalesOrderId` |
| `id` | `SalesOrderItem.nomusItemExternalId` / link `externalSalesOrderItemId` |

**Não** inferir vínculo por nome, cliente, produto, datas, observações ou quantidades.

Telas **não** consultam Nomus na abertura — apenas o banco local / APIs IndusCost.

---

## 2. Modelos

- `NomusProductionOrder` — cabeçalho OP (`externalId` único, `rawJson`, `syncedAt`)
- `NomusProductionOrderSalesLink` — vínculo OP↔Pedido/Item  
  `@@unique([productionOrderExternalId, externalSalesOrderItemId])`  
  FKs locais opcionais (`salesOrderId`, `salesOrderItemId`) resolvidas por IDs externos.

Migration aditiva: `prisma/migrations/20260728120000_nomus_production_orders/`.

---

## 3. Sync

| Artefato | Função |
|----------|--------|
| `src/lib/nomusProductionOrdersMapper.ts` | Parse puro (ex.: `"15.400"` → 15400) |
| `src/lib/nomusProductionOrdersSyncLogic.ts` | CLI, RSQL, paginação, planos |
| `src/lib/nomusProductionOrdersRepository.server.ts` | Upsert idempotente |
| `scripts/nomusProductionOrdersSyncV1.ts` | Preview / apply / incremental / backfill / pontual |

### Comandos

```bash
npm run sync:nomus:production-orders:preview -- --strategy=incremental
npm run sync:nomus:production-orders:apply -- --strategy=backfill
npm run sync:nomus:production-orders:preview -- --externalId=30347
npm run sync:nomus:production-orders:preview -- --name="OP 05800 - 003"
npm run sync:nomus:production-orders:apply -- --salesOrderExternalId=2530
```

### Estratégias

| Estratégia | Comportamento |
|------------|---------------|
| `incremental` | Páginas iniciais (`pagina`/`tamanhoPagina`), máx. páginas limitado |
| `backfill` | Janelas rotativas + cursor em `NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE` |
| `point` | `--externalId`, `--name` e/ou `--salesOrderExternalId` |

Rate limit / retries: `fetchNomusJson` (`NOMUS_MAX_RETRIES`, 429 + `Retry-After` / `tempoAteLiberar`).

Concorrência: o sync de pedidos usa o lock global Nomus (`flock`); o pós-sync de OP roda **dentro** desse fluxo apply — não abre consulta Nomus em UI.

---

## 4. Pós-sync Pedidos de Venda

Após `nomusSalesOrdersSyncV1.ts --apply` com pedidos afetados:

1. materialização de comissões (se habilitada);
2. auto-assign de responsável comercial;
3. **`runNomusProductionOrdersAfterSalesOrdersSync`** (soft-fail).

Desligar: `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC=false`.

---

## 5. Caso comprovado

`GET /rest/ordens?query=nome=="OP 05800 - 003"`:

- OP `externalId` 30347 · `OP 05800 - 003` · Encerrada · Injeção  
- Qtde `"15.400"` → 15400 PC · produto `311.32AA` · `idProduto` 391 · KOPPETEL  
- `itensPedido[0].idPedido` 2530 → Pedido `PD 02534`  
- `itensPedido[0].id` 11324 · item `00010` · qtde `"15.000"` → 15000

---

## 6. Fora de escopo (v1)

- Alterar Pedido / item / NF-e / AR / AP / Fluxo / Comissões / Formação de Preço / Relatório Presidencial / BOM  
- Migration ou backfill em produção a partir do Cursor  
- UI consumindo a tabela (próximo prompt)  
- Tornar OP obrigatória no funil Pedido → Caixa  

---

## 7. Testes

```bash
npm run test:nomus:production-orders
```
