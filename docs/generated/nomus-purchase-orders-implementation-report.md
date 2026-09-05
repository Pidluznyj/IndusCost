# Pedidos de Compra Nomus — relatório de implementação

Espelho **somente leitura** do Pedido de Compra oficial do Nomus. Não é `PurchaseRequest` nem o `PurchaseOrder` interno da cadeia de suprimentos.

## Arquitetura

```
Nomus GET /rest/pedidoscompra
  → nomusRestClient (timeout, 429, retry)
  → parser/mapper tolerante + payloadHash
  → classifier de fase
  → NomusPurchaseOrder / NomusPurchaseOrderItem
  → GET /api/nomus/purchase-orders
  → UI /purchases/nomus-orders
```

Sem writeback. Sem vínculo automático com Solicitação de Compra, recebimento interno ou Contas a Pagar.

## Endpoint

Recurso `pedidoscompra` via `buildNomusUrl`. Contrato **validado ao vivo em 05/09/2026** (HTTP 200, raiz = array, 50 registros/página). Campos oficiais em `nomus-purchase-orders-contract.md`.

## Paginação

`pagina` + `tamanhoPagina` (default 50). Para se `totalPaginas` / `hasMore` / página curta. Backfill: janela de 12 meses (`dataInicio`/`dataFim`). Incremental: 45 dias.

## Modelo

- `NomusPurchaseOrder` — cabeçalho, `rawPayload`, `payloadHash`, `firstSeenAt`/`lastSeenAt`/`syncedAt`.
- `NomusPurchaseOrderItem` — linhas com `lineIndex` estável e raw opcional.
- FKs locais de fornecedor/produto **não** bloqueiam o sync; IDs externos são sempre gravados.

Migration aditiva: `prisma/migrations/20260922120000_nomus_purchase_orders`.

## Classifier

Fases: `CANCELED`, `OPEN`, `APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `UNKNOWN`.

O live não traz status de cabeçalho. A fase sai dos status oficiais 1–8 dos itens (`mapNomusPurchaseOrderItemStatus`). `RECEIVED` só se todos os itens forem `4`. Status `5`/`7`/`8` não viram recebimento/cancelamento financeiro. Quantidade recebida só se a API enviar; status 4 não fabrica `receivedQuantity`.

## Sync

Scripts:

- `npm run nomus:purchase-orders:probe`
- `npm run nomus:purchase-orders:preview` (não grava)
- `npm run nomus:purchase-orders:backfill`
- `npm run nomus:purchase-orders:sync`

Idempotência: `sha256(JSON.stringify(raw))`. Hash igual → só `syncedAt`/`lastSeenAt`. Pedido que some da API **não** é cancelado nem apagado.

## Locks e scheduler

- Lock global: `/tmp/induscost-nomus-sync-global.lock`
- Lock próprio: `/tmp/induscost-nomus-purchase-orders.lock`
- Encadeamento **AR → PO** em `scripts/runNomusAccountsReceivableSync.sh`
- Se AR falhar, PO não inicia.
- Se PO falhar, o exit code de AR é preservado.
- Sem cron novo.

## API

- `GET /api/nomus/purchase-orders` — filtros e paginação no backend
- `GET /api/nomus/purchase-orders/:id` — detalhe + itens; `includeRaw=1` só com `settings.nomus.view` / `settings.view`
- `GET /api/nomus/purchase-orders/health`

## Permissões

`purchases.nomusPurchaseOrders.view` (catálogo) **ou** `purchases.view` **ou** `settings.nomus.view`. Deny > allow. Sem bypass.

## UI

`/purchases/nomus-orders` e detalhe. Entrada **Pedidos Nomus** na faixa da cadeia, separada de Pedidos internos.

## Limitações

- Contrato live validado; `dataInicio`/`dataFim` ainda best-effort.
- Listagem não trouxe `quantidadeAtendida`; recebimento/saldo só se a API enviar.
- Nome/CNPJ do fornecedor e `valorTotal` de cabeçalho não vieram no live.
- Sem vínculo com PurchaseRequest, estoque interno ou AP.
- Preview de 12 meses **não** foi aplicado em banco (sem API local).

## Próximos passos (homolog)

1. `induscost-deploy-homologacao` (manual, fora desta missão).
2. `npm run nomus:purchase-orders:probe`
3. Ajustar aliases se o envelope real divergir.
4. `preview` 12 meses e só então `backfill` apply.
