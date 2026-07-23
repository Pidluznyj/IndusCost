# KAN-LINK-01 — Estado atual dos vínculos operacionais do Kanban

| Item | Valor |
|------|--------|
| Código | KAN-LINK-01 |
| Branch | `feat/kanban-canonical-operational-links` |
| Data | 2026-07-22 |
| Escopo | Auditoria read-only (código, Prisma, syncs, motores, testes, docs) |
| Caso de regressão (fixture) | PD 02757 · DS Nomus 4525 · NF-e 7394/2 |
| Alteração de produção | **Nenhuma** nesta etapa |
| Exceção por pedido | **Proibida** (nenhum `if` para PD 02757) |

---

## 0. Checklist YAGNI / reutilização

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Motor canônico do Kanban | `resolveSalesOrderItemFlow` + `resolveSalesOrderFlow` |
| 2 | Estágio do item | `src/lib/sales/salesOrderItemFlowEngine.ts` |
| 3 | Estágio / gargalo do pedido | `src/lib/sales/salesOrderFlowEngine.ts` + `pickSalesOrderFlowStageFromItemStages` |
| 4 | API da tela | `src/lib/salesOrderFlowRoutes.ts` → `GET /api/commercial/sales-order-flow*` |
| 5 | Snapshots | `SalesOrderFlowSnapshot`, `SalesOrderItemFlowSnapshot`, `SalesOrderFlowEvent` |
| 6 | Syncs | PV `nomusSalesOrdersSyncV1` · OP `nomusProductionOrdersSyncV1` · DS `nomusStockDocumentsSync` · NF `nomusNfesSync` |
| 7 | Resolvedor de vínculos | Evidência OP-49 + alocações + `SalesOrderNfeLink` + `NomusProductionOrderSalesLink` + O2C |
| 8 | Duplicação FE/BE | FE **não** recalcula estágio; só lê snapshots/API |
| 9 | Reutilizar | Sim — sem segundo classificador |
| 10 | Nova tabela / migration | **Não** nesta auditoria |

---

## 1. Diagrama atual das entidades

```mermaid
flowchart TB
  subgraph Nomus
    PVN[Pedido / itens]
    OPN[OP / itensPedido]
    DSN[Documento Estoque]
    NFN[NF-e]
  end

  subgraph IndusCost Stage
    SO[SalesOrder]
    SOI[SalesOrderItem]
    OP[NomusProductionOrder]
    OPL[NomusProductionOrderSalesLink]
    DS[NomusStockDocument]
    DSI[NomusStockDocumentItem]
    NFE[NomusNfe]
    LINK[SalesOrderNfeLink]
    O2C[OrderToCashAuditFact]
  end

  subgraph Kanban
    EV[loadSalesOrderFlowEvidenceBatch]
    AL[buildSalesOrderItemFlowAllocationsFromEvidence]
    IT[resolveSalesOrderItemFlow]
    ORD[resolveSalesOrderFlow]
    SNAP[SalesOrder*FlowSnapshot]
    API[GET sales-order-flow]
    UI[Kanban UI]
  end

  PVN --> SO
  PVN --> SOI
  PVN -->|nfes[]| LINK
  OPN --> OP
  OPN -->|itensPedido| OPL
  OPL --> SO
  OPL --> SOI
  DSN --> DS
  DSN --> DSI
  NFN --> NFE
  DS -->|idNfe| NFE
  LINK --> NFE
  LINK --> SO
  LINK --> O2C
  DS --> O2C
  SOI --> O2C

  SO --> EV
  SOI --> EV
  OPL --> EV
  LINK --> EV
  O2C --> EV
  DS --> EV
  DSI --> EV
  NFE --> EV
  OP --> EV

  EV --> AL --> IT --> ORD --> SNAP --> API --> UI
```

**Ponto estrutural:** não existe FK `NomusStockDocument.salesOrderId`. O DS só entra no pack do Kanban se já houver `SalesOrderNfeLink` e/ou fato O2C que aponte NF/`stockDocumentExternalId` do pedido.

---

## 2. Motores e arquivos responsáveis

| Camada | Arquivo | Função |
|--------|---------|--------|
| Catálogo | `src/lib/sales/salesOrderFlowCatalog.ts` | Estágios, prioridades, próximas ações |
| Item | `src/lib/sales/salesOrderItemFlowEngine.ts` | `resolveSalesOrderItemFlow` / `FromEvidence` |
| Pedido | `src/lib/sales/salesOrderFlowEngine.ts` | Gargalo = estágio mais anterior |
| Alocações DS/NF | `src/lib/sales/salesOrderItemFlowAllocations.ts` | O2C → produto → fallback comercial |
| Evidência pura | `src/lib/sales/salesOrderFlowEvidence.ts` | `assembleSalesOrderFlowEvidenceBatch` |
| Evidência I/O | `src/lib/sales/salesOrderFlowEvidence.server.ts` | `loadSalesOrderFlowEvidenceBatch` |
| Recompute | `src/lib/sales/salesOrderFlowRecompute.server.ts` | Materializa snapshots |
| Pós-sync | `src/lib/sales/salesOrderFlowRecomputeAfterNomusSync.server.ts` | Recalcula pedidos tocados |
| Rebuild | `scripts/rebuildSalesOrderFlow.ts` | Lote preview/apply |
| PV↔NF | `src/lib/salesOrderNfeLink.ts` | `upsertSalesOrderNfeLinksForOrder` |
| Extract NF do PV | `src/lib/salesOrderNomusNfeExtract.ts` | `extractSalesOrderNfesFromNomusPayload` |
| OP↔item | `src/lib/nomusProductionOrdersSalesLinks.server.ts` | `syncNomusProductionOrderSalesLinks` |
| DS mapper | `src/lib/nomusStockDocumentsMapper.ts` | `idNfe`, header/itens |
| O2C | `src/lib/sales/orderToCashAuditBuilder.ts` | Descobre DS via NfeLink; aloca por `externalProductId` |
| API | `src/lib/salesOrderFlowRoutes.ts` | List/summary/detail/recompute |
| Norma | `docs/commercial/sales-order-flow/state-machine.md` | Regras de entrada/saída |

**Pipeline runtime**

```
Nomus → sync/upsert → banco
  → loadSalesOrderFlowEvidenceBatch
  → buildSalesOrderItemFlowAllocationsFromEvidence
  → resolveSalesOrderItemFlow → resolveSalesOrderFlow
  → SalesOrder*FlowSnapshot / Event
  → GET /api/commercial/sales-order-flow*
  → tela (sem reclassificar)
```

---

## 3. Models e campos de ligação (nomes reais Prisma)

### 3.1 `SalesOrder`

| Papel | Campos |
|-------|--------|
| ID interno | `id` |
| ID externo Nomus | `externalSalesOrderId` |
| Código visível | `orderCode`, `externalSalesOrderCode` |
| Empresa / cliente / vendedor | `companyIssuer`, `externalCompanyId`, `customerId`, `externalCustomerId`, `externalSellerId`, `nomusSellerName` |
| Status | `status` |
| Datas | `issueDate`, `expectedDeliveryDate`, `createdAt`, `updatedAt` |
| Sync | `sourceSystem`, `payloadHash`, `sourcePresenceStatus`, `presentInLastPayload`, `firstSeenAt`, `lastSeenAt`, `lastSyncRunId`, `nomusRawResponse` |
| Relações Kanban | `items`, `nfeLinks`, `productionOrderSalesLinks`, `flowSnapshot`, `flowItemSnapshots`, `flowEvents` |

### 3.2 `SalesOrderItem`

| Papel | Campos |
|-------|--------|
| ID interno | `id` |
| ID externo item | `nomusItemExternalId` |
| Sequência / número | `nomusItemSequence` |
| Produto | `productId`, `externalProductId`, `skuSnapshot`, `productNameSnapshot` |
| Quantidade | `quantity`, `unit`, `nomusQuantityFulfilled`, `nomusQuantityPending` |
| Status | `nomusItemStatusRaw`, `nomusItemStatusNormalized`, `nomusIsCanceled`, `nomusIsCut`, `nomusIsStale` |
| Sync / match | `nomusMatchConfidence`, `nomusMatchReason`, `nomusLastSeenAt`, `nomusRawItem` |
| Relações | `productionOrderSalesLinks`, `flowItemSnapshot` |

### 3.3 `NomusProductionOrder`

| Papel | Campos |
|-------|--------|
| ID interno / externo | `id`, `externalId` |
| Produto | `productCode`, `productDescription`, `externalProductId` |
| Qty / status | `quantity`, `unit`, `status`, `tipo` |
| Datas | `openedAt`, `releasedAt`, `closedAt`, `deliveryAt`, `nomusUpdatedAt` |
| Sync | `rawJson`, `payloadHash`, `firstSeenAt`, `lastSeenAt`, `syncedAt` |
| Relações | `salesLinks` |

**Produzida no Kanban:** evidência mantém `producedQuantity = null` (cobertura de OP usa `linkedQuantity` / planejada).

### 3.4 `NomusProductionOrderSalesLink` — OP ↔ pedido/item

| Papel | Campos |
|-------|--------|
| Chave | `(productionOrderExternalId, externalSalesOrderItemId)` unique |
| Oficial Nomus | `externalSalesOrderId` ← `itensPedido[].idPedido` · `externalSalesOrderItemId` ← `itensPedido[].id` |
| Qty | `linkedQuantity` |
| Hint opcional | `itemNumber`, `customerName` (não usados como match fuzzy pelo motor) |
| FK local | `salesOrderId`, `salesOrderItemId` (nullable; resolvidos por IDs externos) |
| Sync | `isCurrent`, `firstSeenAt`, `lastSeenAt`, `removedAt`, `rawJson` |

### 3.5 `NomusStockDocument` — Documento de Saída (stage)

| Papel | Campos |
|-------|--------|
| ID interno / externo | `id`, `externalId` |
| Número comercial | `documentNumber` |
| **Ponte NF** | **`idNfe`** → `NomusNfe.externalId` |
| Tipo / datas | `tipoDocumentoEstoque`, `dataDocumento`, `movementDate` |
| Pessoa / empresa | `personExternalId`, `personName`, `companyExternalId`, `companyName` |
| Status | `statusRaw`, `isCancelled`, `cancelledAt`, `cancellationReason`, `totalValue` |
| Sync | `rawJson`, `payloadHash`, `presentInLastPayload`, `firstSeenAt`, `lastSeenAt`, `syncedAt` |
| **FK Pedido** | **inexistente** |

### 3.6 `NomusStockDocumentItem`

| Papel | Campos |
|-------|--------|
| ID | `id`, `externalItemId` |
| Documento | `stockDocumentId` |
| Produto | `externalProductId` |
| Qty / valor | `quantity`, `unitValue`, `estimatedTotalValue` |
| Sync | `rawJson` |

**Não há** campo tipado `idItemPedido` / `idPedido` no model de item de DS. Se o Nomus enviar isso no payload, fica só em `rawJson` e **não** é consumido pelo motor Kanban.

### 3.7 `NomusNfe`

| Papel | Campos |
|-------|--------|
| ID interno / externo | `id`, `externalId` |
| Visível | `numero`, `serie`, `chave` |
| Status | `status` (autorizada = **4**, cancelada = **7**) |
| Datas | `xmlDhEmi`, `syncedAt` |
| Sync | `rawPayload`, `payloadHash` |

**Não há model de item de NF-e** usado pelo Kanban. Quantidade faturada vem de alocação DS/O2C/fallback, não de linhas da NF.

### 3.8 `SalesOrderNfeLink` — PV ↔ NF

| Papel | Campos |
|-------|--------|
| Chave | `(salesOrderId, nfeExternalId)` unique |
| Pedido | `salesOrderId`, `externalSalesOrderId`, `externalSalesOrderCode`, `orderCode` |
| NF | `nfeExternalId`, `nfeNumber`, `nfeSerie`, `nfeKey`, `nfeStatus`, `nomusNfeId` |
| Sync | `rawPayload`, `presentInLastPayload`, `firstSeenAt`, `lastSeenAt` |

**Origem:** array `nfes[]` do payload do Pedido no sync PV (`extractSalesOrderNfesFromNomusPayload` → `upsertSalesOrderNfeLinksForOrder`). Backfill: `backfill:sales-order-nfe-links:*`.

### 3.9 `OrderToCashAuditFact` (materialização derivada)

Grão: pedido/item × DS × NF × CR. Campos críticos ao Kanban:

- Pedido: `salesOrderId`, `externalSalesOrderId`, `orderCode`
- Item: `salesOrderItemId`, `externalSalesOrderItemId`, `externalProductId`, `orderedQuantity`
- DS: `stockDocumentExternalId`, `stockDocumentIdNfe`, `quantityUsedForOrder`
- NF: `nfeExternalId`, `nfeNumber`, `nfeLinkedBy` (ex.: `"SalesOrderNfeLink"`)
- Run: `runId`, `auditKey`, `lineType`

Descoberta de documentos no builder: **NfeLink → `idNfe` → stock docs**; depois aloca linhas por `externalProductId`.

### 3.10 Snapshots / eventos

**`SalesOrderItemFlowSnapshot`:** `currentStage`, qty (`orderedQuantity`, `productionOrderQuantity`, `producedQuantity`, `documentedQuantity`, `invoicedQuantity`, `shippedQuantity`, `shipTargetQuantity`, `cutQuantity`, `canceledQuantity`, `activeRemainingQuantity`), progressos, `fingerprint`, `computationVersion`, `computedAt`.

**`SalesOrderFlowSnapshot`:** estágio do pedido, gargalo (`bottleneckSalesOrderItemId` / `bottleneckStage`), progressos, valores, `firstShippedAt` / `lastShippedAt` / `completedAt`, `fingerprint`.

**`SalesOrderFlowEvent`:** timeline (`STAGE_CHANGED`, `STAGE_COMPLETED`, …), `dedupeKey`.

### 3.11 Expedição / envio

**Não há** entidade Prisma de expedição nesta cadeia.  
`shippedQuantity === invoicedQuantity` (proxy de NF válida). `hasShipDate` nas alocações costuma ser `false` → inconsistência INFO `NFE_SHIP_DATE_MISSING`.

---

## 4. Classificação das formas de vínculo

| Vínculo | Classificação | Mecanismo |
|---------|---------------|-----------|
| PV header Nomus | direto por ID externo | `SalesOrder.externalSalesOrderId` |
| Item PV Nomus | direto por ID externo | `SalesOrderItem.nomusItemExternalId` |
| OP ↔ item | campo oficial Nomus | `itensPedido[]` → `NomusProductionOrderSalesLink` |
| OP FK local | vínculo por item (resolvido) | `salesOrderId` / `salesOrderItemId` |
| PV ↔ NF | `SalesOrderNfeLink` | `nfes[]` do payload do pedido |
| DS ↔ NF | campo oficial Nomus | `NomusStockDocument.idNfe` |
| DS ↔ PV | **inexistente direto** | só via NfeLink e/ou O2C |
| DS item ↔ PV item | por produto | `externalProductId` (+ O2C `quantityUsedForOrder`) |
| O2C | DS + NF + item materializado | depende de NfeLink para achar DS |
| Envio | proxy frágil | = qty faturada válida |
| Qty produzida | inexistente no motor | sempre `null` na evidência |
| Match por descrição/etiqueta OP | **não usado** | sync OP proíbe inferência por nome |
| Cliente / valor / data próxima | **proibido** nesta etapa | não implementar |

---

## 5. Cadeia atual DS → NF → Pedido

```
Nomus DS (documentosEstoque)
  → mapper: externalId, idNfe, itens[].externalProductId/quantity
  → NomusStockDocument (+ Items)
       │
       │ idNfe
       ▼
NomusNfe (status 4 = autorizada)
       ▲
       │ nfeExternalId
SalesOrderNfeLink ◄── SalesOrder.nomusRawResponse.nfes[]
       │
       ▼
OrderToCashAuditFact (opcional, materializado)
       │
       ▼
loadSalesOrderFlowEvidenceBatch
  nfeExternalIds = NfeLink ∪ O2C.nfeExternalId
  stock docs WHERE externalId ∈ O2C OR idNfe ∈ nfeExternalIds
       │
       ▼
buildSalesOrderItemFlowAllocationsFromEvidence
  1) O2C quantityUsedForOrder
  2) soma itens DS por externalProductId
  3) NF via DS.idNfe
  4) fallback se item comercialmente encerrado
       │
       ▼
documentedQuantity / invoicedQuantity / shippedQuantity
```

### Onde o número do Pedido aparece no DS?

- **Não** há coluna tipada no stage `NomusStockDocument` / item.
- O Kanban **não** lê número de pedido a partir do DS.
- A associação DS→Pedido passa por **NF** (`idNfe` + `SalesOrderNfeLink`) ou fato O2C já materializado.

### Onde o número do item do pedido aparece no DS?

- **Não** há coluna tipada `idItemPedido` no model.
- Match operacional: `NomusStockDocumentItem.externalProductId` ↔ `SalesOrderItem.externalProductId`.
- O2C pode gravar `externalSalesOrderItemId` / `salesOrderItemId` nos facts após esse match.

### Como a NF associa ao DS?

- Campo oficial `NomusStockDocument.idNfe` (= `NomusNfe.externalId`).

### Como nasce `SalesOrderNfeLink`?

1. Sync de Pedidos lê `nfes[]` do payload Nomus do PV.
2. `upsertSalesOrderNfeLinksForOrder`.
3. Backfill dry/apply se o payload histórico não tiver sido persistido.

**Sync de DS ou de NF sozinho não cria `SalesOrderNfeLink`.**

---

## 6. Cadeia atual OP → Pedido → Item

```
Nomus OP.itensPedido[]
  → idPedido, id, quantidade
  → NomusProductionOrderSalesLink
       ├─ resolve SalesOrder.externalSalesOrderId
       └─ resolve SalesOrderItem.nomusItemExternalId
  → evidência productionLinks (isCurrent)
  → productionOrderQuantity = Σ linkedQuantity
  → residual → WAITING_PRODUCTION_ORDER / IN_PRODUCTION
```

Sem `itensPedido` no payload, não há vínculo canônico OP↔item (não há fallback por SKU/descrição no motor).

---

## 7. Cálculo de quantidades e estágio “Aguardando Documento de Saída”

### Quantidades (item)

| Grandeza | Fonte |
|----------|--------|
| `shipTargetQuantity` | obrigação ativa (ordered − cut − canceled; regras FIN-03 / corte) |
| `documentedQuantity` | soma alocações DS válidas (não canceladas) |
| `invoicedQuantity` | soma alocações NF válidas para faturamento |
| `shippedQuantity` | **=** `invoicedQuantity` (proxy) |
| `productionOrderQuantity` | Σ `linkedQuantity` de links OP atuais |

### Decisão pós-produção (`resolvePostProductionStage`)

```
shipTarget <= 0 → SHIPPED_COMPLETED
documented < shipTarget → WAITING_OUTPUT_DOCUMENT
shipped < shipTarget → WAITING_NFE
senão → SHIPPED_COMPLETED
```

Pedido no Kanban = estágio do **gargalo** (menor prioridade entre itens ativos).

---

## 8. Pontos em que a cadeia pode ser perdida

1. Payload do PV sem `nfes[]` → sem `SalesOrderNfeLink`.
2. DS sincronizado com `idNfe` null / errado.
3. Confusão **número** NF (`7394`) vs **`externalId`** Nomus (chave do Kanban).
4. NF status ≠ 4 → não conta como faturada/enviada.
5. `externalProductId` null ou divergente entre item PV e linha DS → alocação 0.
6. O2C não materializado e NfeLink ausente → loader **não carrega** DS no pack.
7. Sync DS pós-sync Kanban: `resolveSalesOrderIdsFromStockDocumentExternalIds` só acha PV via NfeLink/O2C — DS órfão **não** dispara recompute do pedido.
8. Snapshot stale (`FALSE_WAITING_OP` / `STALE_SNAPSHOT` na integrity audit).
9. DS cancelado filtrado nas alocações.
10. Qty documentada parcial < `shipTarget` → permanece `WAITING_OUTPUT_DOCUMENT` mesmo com links parciais.

---

## 9. Por que o PD 02757 pode não ser reconhecido (hipóteses genéricas)

Caso informado (fixture de regressão, **sem** hardcode no código):

| Dado | Valor |
|------|--------|
| Pedido | PD 02757 |
| DS Nomus | 4525 |
| NF-e | 7394/2 autorizada |
| Emissão NF | 20/07/2026 14:40 |
| Empresa | Koppetel |
| Valor | R$ 12.650,40 |
| Itens | 00010 (114), 00020 (360) |

Hipóteses **somente por caminhos de código** (ordenadas por probabilidade estrutural):

1. **Ausência / stale de `SalesOrderNfeLink`** para o `nfeExternalId` real da NF — DS 4525 nunca entra no pack.
2. **`idNfe` do DS 4525** não aponta para o `externalId` da NF (ou está null).
3. **“7394” é número**, não `externalId` — auditorias/UI que usam número sem resolver externalId falham silenciosamente no motor.
4. **Mismatch de `externalProductId`** nas linhas 114/360 → `documentedQuantity = 0` sem fallback comercial.
5. Itens **não** `FULLY_FULFILLED` → fallback comercial de alocação não aplica.
6. **O2C sem fato** para o pedido + NfeLink ausente → mesma cegueira do loader.
7. **Snapshot** ainda em `WAITING_OUTPUT_DOCUMENT` com cálculo já avançado (stale) — ou cálculo realmente com doc=0.
8. Recompute pós-sync de DS **não selecionou** o PV (sem NfeLink/O2C).

Nenhuma hipótese exige (nem permite) exceção por `orderCode === "PD 02757"`.

---

## 10. Riscos de duplicação

| Risco | Mitigação atual |
|-------|-----------------|
| Mesmo DS via O2C + match produto | Dedup por `allocationKey` / skip se já em O2C |
| NF de múltiplas fontes | Accumulator por `externalId` + sources set |
| Rebuild duplo | Fingerprint + `dedupeKey` de eventos |
| NfeLink + O2C | Preferência O2C na qty; NF deduplicada |
| Fallback comercial + O2C | Só preenche **gap** se cobertura &lt; obrigação |

---

## 11. Riscos de vínculo incorreto

| Risco | Severidade | Nota |
|-------|------------|------|
| Match só por `externalProductId` (dois itens mesmo produto) | Alta | Pode alocar qty na linha errada |
| Fallback comercial sem linha DS | Média | Usa gap do item encerrado; depende de NF no pack |
| Proxy envio = faturado | Média | Não prova expedição física |
| NfeLink multi-pedido no lote | Média | Conflito `NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH` |
| Inferência cliente/valor/data | — | **Proibida** nesta fase |

---

## 12. Lacunas de testes

| Coberto | Lacuna |
|---------|--------|
| Alocações com pack injetado (O2C / produto / fallback) | Integração do **loader**: DS sem NfeLink e sem O2C deve ficar **fora** do pack |
| Comentário “NF via idNfe sem NfeLink” usa O2C para colocar DS no pack | Não prova caminho loader sem NfeLink |
| Matrix KAN-VAL-01 / fulfilled-without-OP | Poucos casos “NF autorizada no stage + sem SalesOrderNfeLink” |
| OP sales links por `nomusItemExternalId` | Corridas sync OP antes do item local |
| Integrity `MISSING_FISCAL_LINKS` / `FALSE_WAITING_OP` | Não amarra DS órfão → Kanban stuck como regressão nomeada |
| `hasShipDate: false` hardcoded | Sem fonte real de data de envio |

---

## 13. Proposta inicial de contrato canônico (somente desenho)

> Não implementar nesta etapa.

**Contrato alvo (conceitual):**

```
SalesOrderItemOperationalLink {
  salesOrderId
  salesOrderItemId
  externalSalesOrderId
  externalSalesOrderItemId
  externalProductId

  production: [{ productionOrderExternalId, linkedQuantity, isCurrent }]
  documents:  [{ stockDocumentExternalId, quantity, idNfe, isCancelled }]
  nfes:       [{ nfeExternalId, number, serie, status, quantity, hasDocument }]
  shipment:   { quantity, evidence: "NFE_PROXY" | "EXPLICIT_SHIP_DATE", at? }
}
```

**Regras candidatas (próximas etapas, sem fuzzy):**

1. Fonte preferencial de DS↔item: ID oficial Nomus de item de pedido **quando existir no raw** e for tipado/persistido.
2. Enquanto não tipado: manter produto + O2C, com teste de loader gate.
3. `SalesOrderNfeLink` continua obrigatório para descoberta DS↔PV **ou** evoluir discovery oficial sem cliente/valor/data.
4. Um único resolvedor alimenta motor + auditoria + O2C (sem segundo classificador FE).

**KAN-LINK-02 (implementado):** contrato `SalesOrderOperationalEvidenceGraph` — ver `docs/commercial/sales-order-flow/operational-evidence-contract.md` e `src/lib/sales/salesOrderOperationalEvidence*.ts`. Não é um segundo motor; adapta coberturas válidas para `resolveSalesOrderItemFlow`.

**KAN-LINK-03 (implementado):** auditoria read-only `npm run audit:sales-order:operational-links -- --order="PD 02757"` (`src/lib/sales/salesOrderOperationalLinkageAudit*.ts`). Sem writes/Nomus; saída só com `--output` + `--json`/`--markdown`.

---

## 14. Comandos read-only para validar PD 02757 no servidor

Executar em `/opt/induscost` (ou ambiente com `DATABASE_URL` da base real). **Não** usar `:apply` nesta auditoria.

```bash
# 1) Auditoria completa do fluxo (calc × snapshot × evidências)
npm run audit:sales-order:flow -- --order="PD 02757"

# 2) Documento de saída + pedido + NF (número ou externalId)
npm run audit:output-documents:db -- --document=4525 --order=PD02757 --nfe=7394

# 3) Preview de rebuild (não grava) — o que o motor faria no snapshot
npm run rebuild:sales-order-flow -- --preview --order="PD 02757"

# 4) Integrity em lote (opcional; classifica FALSE_WAITING_OP / MISSING_FISCAL_LINKS)
npm run audit:sales-order:flow:integrity -- --from=2026-01-01 --to=2026-12-31

# 5) Dry-run de backfill de SalesOrderNfeLink (não grava)
npm run backfill:sales-order-nfe-links:dry
```

### Checklist de leitura dos relatórios

Para PD 02757, confirmar no JSON/MD do audit de fluxo:

- [ ] Existe `SalesOrderNfeLink` com `nfeExternalId` coerente (não só número 7394).
- [ ] `stockDocuments` inclui externalId **4525** e `idNfe` preenchido.
- [ ] Itens 00010/00020: `documentedQuantity` ≥ 114 e 360 (ou gap explicado).
- [ ] `calculatedStage` vs `persistedSnapshot.currentStage`.
- [ ] `productionOrderLinks` (se houver OP) e se o gargalo é mesmo DS.
- [ ] Seção `canonicalLinks.linksVisibleToKanban` (quando deploy ≥ hardening de audit).

---

## 15. Arquivos analisados (principais)

- `prisma/schema.prisma` — models listados
- `src/lib/sales/salesOrderItemFlowEngine.ts`
- `src/lib/sales/salesOrderFlowEngine.ts`
- `src/lib/sales/salesOrderFlowCatalog.ts`
- `src/lib/sales/salesOrderFlowEvidence.ts` / `.server.ts`
- `src/lib/sales/salesOrderItemFlowAllocations.ts`
- `src/lib/sales/salesOrderFlowRecompute*.ts`
- `src/lib/sales/salesOrderFlowRecomputeAfterNomusSync*.ts`
- `src/lib/sales/orderToCashAuditBuilder.ts`
- `src/lib/salesOrderNfeLink.ts`
- `src/lib/salesOrderNomusNfeExtract.ts`
- `src/lib/nomusProductionOrdersSalesLinks.server.ts`
- `src/lib/nomusStockDocumentsMapper.ts`
- `src/lib/salesOrderFlowRoutes.ts`
- `scripts/nomusSalesOrdersSyncV1.ts`
- `scripts/nomusProductionOrdersSyncV1.ts`
- `scripts/nomusStockDocumentsSync.ts`
- `scripts/nomusNfesSync.ts`
- `scripts/auditSalesOrderFlow.ts`
- `scripts/auditSalesOrderFlowIntegrity.ts`
- `scripts/auditOutputDocumentsDb.ts`
- `docs/commercial/sales-order-flow/state-machine.md`
- Testes: `salesOrderItemFlowAllocations.test.ts`, `salesOrderFlowEvidence.test.ts`, `salesOrderFlowFulfilledWithoutProduction.test.ts`, `salesOrderFlowKanVal01Matrix.test.ts`, `salesOrderFlowIntegrityAudit.test.ts`

---

## 16. Conclusão da auditoria

O Kanban já possui um **motor canônico único** e vínculos oficiais claros para **OP↔item** e **PV↔NF**. O elo frágil é **DS↔Pedido**: não há FK tipada; a descoberta depende de `SalesOrderNfeLink` e/ou O2C + `idNfe`. Isso explica, em termos genéricos, um pedido com DS/NF visíveis no Nomus ainda parado em **Aguardando Documento de Saída** no Kanban.

**Próximo passo (fora deste commit):** rodar os comandos da §14 no servidor e, com evidência, decidir se a integração canônica exige persistir IDs de item de pedido vindos do DS raw, reforçar NfeLink, ou ambos — sem fuzzy matching e sem exceção por pedido.
