# Integração oficial — Ordens de Produção Nomus (`/rest/ordens`)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Endpoint** | `GET /rest/ordens` |
| **Status** | Stage local oficial + operações (OP-03…OP-12) |
| **Data** | 2026-07-16 |

> Runbook operacional completo: [`../production-orders/operations.md`](../production-orders/operations.md)  
> Descoberta prévia: [`nomus-production-orders-api-discovery.md`](./nomus-production-orders-api-discovery.md)  
> Contrato: [`../production-orders/api-contract.md`](../production-orders/api-contract.md)

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

## 3. Sync e operações

| Artefato | Função |
|----------|--------|
| `nomusProductionOrdersMapper.ts` | Parse puro |
| `nomusProductionOrdersClient.ts` | HTTP `/rest/ordens` |
| `nomusProductionOrdersPersist.server.ts` | Persistência idempotente |
| `nomusProductionOrdersSalesLinks.server.ts` | Vínculos + reconcile |
| `nomusProductionOrdersBackfill*.ts` | Backfill + checkpoint |
| `nomusProductionOrdersIncremental*.ts` | Incremental + overlap 72h |
| `nomusProductionOrdersLookup*.ts` | Consulta pontual + reconcile |
| `nomusProductionOrdersSyncLock*.ts` | Lock + auditoria + IntegrationRun |
| `scripts/runNomusProductionOrdersSync.sh` | Runner shell (flock), padrão AR/NF-e |

### Comandos oficiais

```bash
npm run sync:nomus:production-orders:preview
npm run sync:nomus:production-orders:apply
npm run sync:nomus:production-orders:backfill:preview
npm run sync:nomus:production-orders:backfill:apply
npm run sync:nomus:production-orders:incremental:preview
npm run sync:nomus:production-orders:incremental:apply
npm run sync:nomus:production-orders:reconcile

# pontual / suporte
npm run sync:nomus:production-orders:lookup:preview -- --name="OP 05800 - 003"
npm run sync:nomus:production-orders:lookup:apply -- --external-id=30347

# shell
bash scripts/runNomusProductionOrdersSync.sh incremental apply
```

Filtros pontuais SyncV1 (legado unificado): `--externalId`, `--name`, `--salesOrderExternalId`.

---

## 4. Pós-sync Pedidos de Venda

Após `nomusSalesOrdersSyncV1.ts --apply` **concluir com sucesso**:

1. materialização de comissões (se habilitada e houver IDs afetados);
2. auto-assign de responsável comercial (se houver IDs afetados);
3. **`runNomusProductionOrdersAfterSalesOrdersSync`** → **incremental apply** (OP-13; soft-fail).

Regras:

- falha em Pedidos → OP **não** inicia (hook só no fim do apply);
- falha / lock em OP → pedidos **permanecem válidos**; falha logada claramente;
- **nunca** backfill automático; **nunca** full scan;
- uma única execução de OP por fluxo de pedidos;
- `respectGlobalLock=false` (já sob flock global dos pedidos).

Fluxos que herdam o hook (via `sales-orders:apply`):

- `scripts/runNomusSalesOrdersSync.sh` (rotina ~2h);
- `scripts/runNomusSalesOrdersWideReconciliation.sh`;
- `npm run sync:nomus:sales-orders:apply`;
- orquestrador quando o target `sales-orders` apply roda.

**Não** aplicável: daily sync (não inclui sales-orders), AR/AP/NF-e admin.

Desligar: `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC=false`.

---

## 5. Caso comprovado

`GET /rest/ordens?query=nome=="OP 05800 - 003"`:

- OP `externalId` 30347 · `OP 05800 - 003` · Encerrada · Injeção  
- Qtde `"15.400"` → 15400 PC · produto `311.32AA` · `idProduto` 391 · KOPPETEL  
- `itensPedido[0].idPedido` 2530 → Pedido `PD 02534`  
- `itensPedido[0].id` 11324 · item `00010` · qtde `"15.000"` → 15000

---

## 6. Fora de escopo (sync v1)

- Alterar Pedido / item / NF-e / AR / AP / Fluxo / Comissões / Formação de Preço / Relatório Presidencial / BOM  
- Migration ou backfill em produção a partir do Cursor  
- UI consumindo a tabela (próximo prompt de produto)  
- Tornar OP obrigatória no funil Pedido → Caixa  

---

## 7. Testes

```bash
npm run test:nomus:production-orders
```
