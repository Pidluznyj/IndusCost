# OP-01 — Estado atual da infraestrutura de sincronização Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Prompt** | OP-01 — Auditoria |
| **Data** | 2026-07-16 |
| **Escopo** | Somente documentação — sem migration/sync novos neste prompt |

Documentos irmãos:

- [`target-architecture.md`](./target-architecture.md)
- [`api-contract.md`](./api-contract.md)
- [`operations.md`](./operations.md) — **runbook e comandos (OP-12)**
- Integração: [`../integrations/nomus-production-orders-sync.md`](../integrations/nomus-production-orders-sync.md)
- Descoberta: [`../integrations/nomus-production-orders-api-discovery.md`](../integrations/nomus-production-orders-api-discovery.md)

---

## 1. Sincronizadores Nomus (inventário)

### 1.1 Core HTTP → banco

| Domínio | Script | npm | Cliente HTTP |
|---------|--------|-----|--------------|
| Clientes | `scripts/nomusCustomersSyncV1.ts` | `sync:nomus:customers:dry\|apply` | inline (legado) |
| Produtos | `scripts/nomusProductsSyncV1.ts` | `sync:nomus:products:dry\|apply` | inline |
| BOM components | `scripts/nomusBomComponentsSyncV1.ts` | `sync:nomus:bom-components:dry\|apply` | inline |
| Propostas | `scripts/nomusProposalsSyncV1.ts` | `sync:nomus:proposals:dry\|apply` | inline |
| Pedidos de Venda | `scripts/nomusSalesOrdersSyncV1.ts` | `sync:nomus:sales-orders:dry\|apply` | inline `fetchJsonWithRetry` |
| **Ordens de Produção** | `scripts/nomusProductionOrdersSyncV1.ts` | `sync:nomus:production-orders:preview\|apply` | **`nomusRestClient`** |
| Contas a Receber | `scripts/nomusAccountsReceivableSync.ts` | `…:apply` (+ CLI preview) | `nomusRestClient` |
| Contas a Pagar | `scripts/nomusAccountsPayableSync.ts` | `…:preview\|apply` | `nomusRestClient` |
| NF-e | `scripts/nomusNfesSync.ts` | `…:preview\|apply\|dry` | `nomusRestClient` |
| Documentos de estoque | `scripts/nomusStockDocumentsSync.ts` | `…:preview\|apply` | `nomusRestClient` |

### 1.2 Orquestração / engenharia

| Peça | Path |
|------|------|
| Orquestrador comercial | `scripts/nomusSyncOrchestrator.ts` — targets: customers → products → bom-components → proposals → sales-orders |
| Daily sync (UI/API) | `src/lib/nomusDailySyncRunner.ts` + `scripts/runNomusDailySync.sh` |
| BOM auto-apply pós sync | `scripts/nomusBomAutoApplyAfterSyncV1.ts` |
| Família BOM / master-data / registry | `scripts/nomusBom*.ts`, `scripts/nomusMasterData*.ts`, `scripts/registry*.ts` |

### 1.3 Runners de domínio (spawn + flock)

- `src/lib/nomusAccountsReceivableSyncRunner.ts`
- `src/lib/nomusAccountsPayableSyncRunner.ts`
- `src/lib/nomusNfesSyncRunner.ts`
- Settings: `src/lib/settingsNomusSyncRoutes.ts`

---

## 2. Cliente HTTP Nomus

**Canônico:** `src/lib/nomusRestClient.ts`

| Símbolo | Função |
|---------|--------|
| `buildNomusHeaders` | `Accept` + auth |
| `buildNomusUrl` | base + resource; evita `/rest/rest` |
| `fetchNomusJson` | GET + retries 429/5xx |
| `redactHeadersForLog` / `redactNomusUrlForLog` / `sanitizeNomusErrorBody` | logs seguros |
| `describeNomusCredential` | presença/tamanho/hash — nunca o segredo |

**Duplicação:** scripts comerciais V1 (`customers`, `products`, `bom-components`, `proposals`, `sales-orders`) mantêm `buildNomusHeaders` / `buildNomusUrl` / `fetchJsonWithRetry` **inline**, sem importar o cliente compartilhado.

---

## 3. Autenticação

| Variável | Uso |
|----------|-----|
| `NOMUS_BASE_URL` | obrigatória nos syncs |
| `NOMUS_TOKEN` | `Authorization: Bearer …` |
| `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` | header custom (ex.: Basic); pode coexistir com Bearer |
| `NOMUS_AUTH` | aparece em redaction/probes; **não** é aplicado por `buildNomusHeaders` |

---

## 4. Paginação

Padrão dominante: query `pagina` + `tamanhoPagina`; metadados `totalPaginas` / `totalPages` / `paginas`.

| Domínio | Particularidade |
|---------|-----------------|
| Pedidos | filtros `dataEmissaoInicial/Final` (+ vencimento); cursor arquivo `NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE` (`nomusSalesOrdersPaginationCursor.ts`) |
| OP | `pagina`/`tamanhoPagina` + RSQL pontual; cursor backfill `NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE` |
| AR/AP/NF-e | helpers `hasNext*Page` / planos em `*SyncLogic.ts` |
| Stock docs | RSQL em `dataEmissao` + tipo |

---

## 5. HTTP 429

Em `fetchNomusJson` (e espelho legado):

1. corpo JSON `tempoAteLiberar` (segundos + 1s);
2. senão header `Retry-After`;
3. senão backoff exponencial `retryBaseMs * 2^attempt` (default base 700 ms).

Env: `NOMUS_MAX_RETRIES` (default 10). Sales-orders ainda conta `http429Count` em stats.

---

## 6. HTTP 5xx

Mesmo loop de retry: `status >= 500` é retryable até esgotar `maxRetries`; depois throw com corpo sanitizado (cliente compartilhado).

---

## 7. Timeout

**Ausente.** Chamadas usam `fetch(url, { method: "GET", headers })` sem `AbortSignal` / timeout de request. Risco operacional em hang de rede.

---

## 8. Parsing decimal brasileiro

| Símbolo | Path |
|---------|------|
| `parseNomusPtBrNumber` | `scripts/nomusNumberParser.ts` |
| `parseNomusOptionalMoney` | `src/lib/nomusAccountsReceivableParser.ts` |
| Testes | `scripts/nomusNumberParser.test.ts` |

Regra comprovada OP: `"15.400"` → `15400`; `"15.000"` → `15000` (milhar com ponto).

---

## 9. Parsing de datas Nomus

| Símbolo | Path |
|---------|------|
| `parseNomusBrDateTime` / `parseNomusBrDate` | `nomusAccountsReceivableParser.ts` |
| `parseNomusBrOrIsoDate` | `salesOrderNomusRaw.ts` |
| `parseNomusPedidoDataEmissao` | `nomusSalesOrdersSyncWindow.ts` |
| `parseNomusDateTime` (local) | scripts V1 pedidos/propostas |
| `parseNomusNfeProcessingDate` | `salesOrderNomusNfeExtract.ts` |

Formatos típicos: `dd/MM/yyyy[ HH:mm[:ss]]` ou ISO.

---

## 10. Locks

| Arquivo | Uso |
|---------|-----|
| `/tmp/induscost-nomus-sync-global.lock` (`NOMUS_SYNC_LOCK_FILE`) | daily + sales-orders shells |
| `/tmp/induscost-nomus-accounts-receivable.lock` | AR |
| `/tmp/induscost-nomus-accounts-payable.lock` | AP |
| `/tmp/induscost-nomus-nfes.lock` | NF-e |

Padrão: `flock -n` no bash; probe Node via `spawnSync("flock", …)` (`nomusDailySyncRunnerShared.ts`). Em Windows o probe tende a no-op.

**OP:** não tem shell/lock próprio; roda após sales-orders **dentro** do apply (herda o lock global do shell de pedidos quando aplicável).

---

## 11. SyncRun / SyncState / equivalentes

| Model | Existe? | Notas |
|-------|---------|-------|
| `SyncState` | **Não** | — |
| `SyncRun` | **Não** | — |
| `IntegrationRun` | **Sim** | Ledger oficial (`sourceSystem`, `target`, `mode`, contagens, `summaryJson`) — usado por AR/AP/NF-e/orquestrador |
| `EngineeringSyncRun` | Sim | Engenharia preview/apply |
| `NomusBomApplyRun` | Sim | Auditoria BOM controlado |

**Gap OP:** sync de OP ainda **não** persiste `IntegrationRun` (só log JSON no stdout).

Cursors de página: **arquivo**, não tabela.

---

## 12. Padrão preview / apply

| Estilo | Domínios |
|--------|----------|
| Flag `--apply` (default dry) | customers, products, bom-components, proposals, sales-orders, orchestrator |
| Posicional `preview` \| `apply` | AR, AP, NF-e, stock-documents, **production-orders** |

Helpers tipicamente: `shouldWrite*(mode)` — preview não grava.

---

## 13. Scripts shell

| Path | Papel |
|------|-------|
| `scripts/runNomusDailySync.sh` | lock global; customers→products→bom→proposals (**sem** sales-orders) |
| `scripts/runNomusSalesOrdersSync.sh` | lock global; janela recente |
| `scripts/runNomusSalesOrdersWideReconciliation.sh` | full reconciliation |
| `scripts/runNomusAccountsReceivableSync.sh` | lock AR |
| `scripts/runNomusAccountsPayableSync.sh` | lock AP |
| `scripts/runNomusNfesSync.sh` | lock NF-e |

Não há `runNomusProductionOrdersSync.sh` ainda.

---

## 14. package.json (grupos)

- Comercial: customers, products, bom-components, proposals, sales-orders  
- **Produção:** `sync:nomus:production-orders:preview|apply`, `test:nomus:production-orders`  
- Financeiro stage: AR, AP, nfes, stock-documents  
- Orquestração: `all:dry`, `all:apply`, `all:apply-and-bom`  
- Engenharia: bom-*, master-data-*, registry-*, product-import-*  

---

## 15. Orquestradores

1. `nomusSyncOrchestrator.ts` — fila comercial + BOM auto-apply após apply  
2. Daily runner — subset sem pedidos  
3. Sales-orders shell — cron separado  
4. Pós-hooks no apply de pedidos (ver §16)

OP **não** é target do orquestrador; entra via pós-hook de pedidos.

---

## 16. Sincronização de Pedidos de Venda

| Item | Detalhe |
|------|---------|
| Entry | `scripts/nomusSalesOrdersSyncV1.ts` |
| Recurso Nomus | `pedidos` |
| Janela | `nomusSalesOrdersSyncWindow.ts` — `recent-window` vs `full-reconciliation` |
| Upsert | `salesOrderNomusSync.server.ts` + custos `salesOrderNomusSyncCost.server.ts` |
| Links NF | `salesOrderNfeLink.ts` dentro do apply por pedido |
| Pós-apply (soft-fail onde indicado) | (1) comissões `runCommissionMaterializationAfterNomusSync` (2) auto-assign comercial (3) **`runNomusProductionOrdersAfterSalesOrdersSync`** |

---

## 17. Models Product / SalesOrder / SalesOrderItem — IDs Nomus

### Product

- `sourceSystem`, `sourceExternalId` (string)
- `isNomusControlled`, `lastNomusSyncAt`, `nomusPayloadHash`

### SalesOrder

- `sourceSystem`
- `externalSalesOrderId` (Int?, **sem unique**)
- `externalSalesOrderCode`, `externalCustomerId`, `externalSellerId`, `nomusSellerName`, `externalCompanyId`
- `sentToNomusAt`, `nomusRawResponse`
- relação `productionOrderSalesLinks`

### SalesOrderItem

- `externalProductId`
- `nomusItemExternalId` ← `itensPedido[].id`
- `nomusItemSequence`, status/qty Nomus, `nomusIsStale` / `Canceled` / `Cut`
- `nomusRawItem`, `nomusLastSeenAt`
- relação `productionOrderSalesLinks`

`Customer` não tem ID Nomus dedicado (match por `taxId`).

---

## 18. Padrão repository / service

**Preferido (finance + OP + stock):**

```text
script → *SyncLogic (puro) → *Mapper → *Repository.server / upsert → (opcional) IntegrationRun → (opcional) SyncRunner
```

**Legado comercial V1:** script monolítico (HTTP + Prisma + preview no mesmo arquivo).

OP atual: `nomusProductionOrdersMapper` + `SyncLogic` + `Repository.server` + script.

---

## 19. Padrão de testes dos sincronizadores

| Tipo | Exemplos |
|------|----------|
| Unit puro (`tsx --test`) | `nomusProductionOrders.test.ts`, `nomusStockDocuments.test.ts`, `nomusAccountsReceivable.test.ts`, `nomusSalesOrdersSyncWindow.test.ts` |
| Contrato de fonte (lê script) | pagination cursor / wiring OP |
| Runner/lock | `nomusDailySyncRunner.test.ts` |
| Parser | `nomusNumberParser.test.ts` |
| npm domain | `test:nomus:production-orders`, `test:nomus:sales-orders-sync`, `test:nomus:nfes`, … |

Padrão: **não** bater na API Nomus nos unit tests; fixtures sanitizadas.

---

## 20. O que já existe de Ordens de Produção

| Artefato | Status |
|----------|--------|
| `NomusProductionOrder` / `NomusProductionOrderSalesLink` | **Existe** (schema + migration `20260728120000_nomus_production_orders`) |
| Script sync V1 | **Existe** (`nomusProductionOrdersSyncV1.ts`) |
| Pós-hook após Pedidos | **Existe** (soft-fail) |
| Docs integrations | **Existem** |
| `extractNomusProductionOrders` | Legado — OP embutida em `SalesOrder.nomusRawResponse` (UI lifecycle) |
| `InventoryMovement.productionOrderId` | Placeholder UUID **sem FK** para `NomusProductionOrder` |
| Shell dedicado / `IntegrationRun` OP / UI leitura stage | **Ausentes** |
| Timeout HTTP / unificação cliente V1 | **Ausentes** (infra geral) |

---

## 21. Conclusão da auditoria

A plataforma já tem **dois stacks HTTP**, ledger `IntegrationRun` maduro no financeiro, locks por flock, e um **stage de OP v1** alinhado ao contrato oficial `itensPedido.idPedido` / `itensPedido.id`.

Para a linha OP, o ganho seguinte não é “inventar sync do zero”, e sim: endurecer observabilidade (`IntegrationRun`), operação (shell/cron), consumo em UI **somente via DB**, e eventualmente unificar cliente HTTP legado — ver [`target-architecture.md`](./target-architecture.md).
