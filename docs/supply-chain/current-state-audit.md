# Auditoria do estado atual — Compras, Estoque e Almoxarifado (OP-01)

**Data:** 2026-07-21  
**Escopo:** somente leitura (sem alteração de comportamento, schema ou telas).  
**Cadeado:** `.cursor/rules/supply-chain-guardrails.mdc` (OP-00).  
**Ambiente de dados:** o Cursor **não** acessa banco/produção; “tabelas vazias” abaixo = inferência de produto (MVP pouco usado / UI coming soon) + dependência de código. Contagem real de linhas exige query operacional autorizada fora deste OP.

---

## 1. Resumo executivo

| Domínio | Situação | Ação recomendada para a Cadeia de Suprimentos |
|---------|----------|-----------------------------------------------|
| Matérias-primas + Inteligência de Mercado | **Funciona** (cadastro + cotações + anexos) | **Proteger** — consumo só por leitura |
| Produtos + BOM (+ sync/apply Nomus) | **Funciona** | **Proteger** — leitura; não mutar |
| Solicitações de compra (`PurchaseRequest*`) | **Funciona** (fase 1, sem PO/recebimento) | **Reaproveitar** como SC oficial local |
| Estoque local (`Inventory*`) | **MVP completo** (API+UI); integrações **desligadas** | **Reaproveitar** como base de almoxarifado/saldos/movimentos |
| Fornecedores financeiros (`FinancialSupplier`) | **Funciona** (AP) | **Reaproveitar IDs**; não criar cadastro paralelo |
| Centros de custo | **Dois motores** (`CostCenter` compras vs `FinancialCostCenter` AP) | Não misturar; mapear explicitamente |
| Documentos de estoque Nomus | Stage **forte**, default **DocumentoSaida** | Leitura; entrada não productizada |
| NF-e Nomus | Stage **forte**; billing descarta entrada | Não tratar como recebimento |
| OPs Nomus | Sync + UI read-only | **Proteger** |
| Pedido de compra / cotação SC / recebimento físico | **Ausentes** como modelos de 1ª classe | Greenfield (aditivo, atrás de flag) |
| Anexos genéricos de compra/recebimento | **Ausentes** | Reusar padrão `appLocalFileStorage` + anexos MI |

---

## 2. O que funciona e deve ser protegido

Motores oficiais (fase 1 da SC: **somente leitura**):

1. **Matérias-primas** — `Material` + APIs `/api/materials*` + UI `/materials`  
   - Evidência: `prisma/schema.prisma` (modelo `Material`, ~L217+); `ResourceKeys.SUPRIMENTOS` em `src/lib/permissionsClient.ts` L68–75, L456+.
2. **Produtos e componentes** — `Product` + `/api/products*` + UI `/products`  
   - Evidência: `schema.prisma` ~L675–714.
3. **BOM** — `ProductBOM` + compare/apply Nomus (`NomusBomComponentStage`, `NomusBomApplyRun`)  
   - Evidência: `schema.prisma` L716–737; stage L2187+; apply L3352+.
4. **Custos publicados / precificação / Inteligência de Mercado** — `MaterialMarketQuote*` e fluxos MI  
   - Evidência: `schema.prisma` L318–427; anexos L410–427; rotas em `server.ts` + `materialMarketQuoteAttachmentRoutes.ts`.
5. **Pedidos de venda** — `SalesOrder` / itens / links NFe (comercial/financeiro) — fora do dono da SC.
6. **Comissões / financeiro oficial / Contas a Pagar** — `NomusAccountsPayable`, alocações, fornecedores financeiros.  
   - Evidência: `FinancialSupplier` L4725+; `AccountsPayableCostCenterAllocation` L5059+.
7. **Sincronizações Nomus** — produtos, BOM, stock documents, NFes, OPs (scripts `sync:nomus:*`).  
   - Evidência: `package.json` scripts; `scripts/nomusStockDocumentsSync.ts`; `NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO` em `src/lib/nomusStockDocumentsSyncLogic.ts` L11.
8. **Ordens de produção oficiais** — `NomusProductionOrder*` + UI `/production-orders` read-only.  
   - Evidência: `schema.prisma` ~L2486–2598; `registerProductionOrdersRoutes`.

**Estoque local já operacional (dono potencial da SC, não “protegido” no sentido de motor de engenharia/financeiro):**

- Itens, almoxarifados, locais, saldos, movimentações, conferências — UI `/inventory/*`, API `registerInventoryRoutes` (`src/lib/inventoryRoutes.ts`).
- Saldo só via `createInventoryMovement` (regra documentada em `docs/inventory-future-integrations.md` L5–6).
- Integrações cross-módulo **desligadas**: `INVENTORY_INTEGRATIONS_ENABLED = false` em `src/lib/inventory/inventoryIntegrationTypes.ts` L10; assert L118–119; teste `src/lib/inventoryIntegrations.test.ts` L27.

---

## 3. Estruturas Prisma relevantes (mapa)

### 3.1 Compras locais

| Modelo | Arquivo:linhas | Observação |
|--------|----------------|------------|
| `CostCenter` | `prisma/schema.prisma` L1436–1448 | CC operacional de compras/estoque (≠ financeiro) |
| `PurchaseRequest` | L1450–1468 | Solicitações; statuses PT |
| `PurchaseRequestItem` | L1470–1496 | Linhas MP/indireto; `materialId?`; **não** altera cadastro Material |
| Enums compra | ~L1941–1963 | Status/prioridade/tipo linha |

**Migration:** `prisma/migrations/20260410120000_purchases_block1` (+ block2 MP context).

**Ausente:** `PurchaseOrder`, cotação/rodada de compra, recebimento.

### 3.2 Estoque / Almoxarifado locais

Bloco comentado: `schema.prisma` L5111 — `// —— Estoque / Almoxarifado (módulo independente Fase 1) ——`

| Modelo | Linhas (aprox.) | Papel |
|--------|-----------------|-------|
| `InventoryItem` | ~5197–5235 | Catálogo logístico; `productId?` → Product |
| `InventoryWarehouse` | L5237–5256 | Almoxarifado |
| `InventoryLocation` | ~5258–5277 | Local |
| `InventoryMovement` | L5279–5343 | Movimentos (incl. `PURCHASE_ENTRY`); soft refs PO/PV/OP/NFe |
| `InventoryBalance` | ~5345–5370 | Saldos |
| `InventoryReservation` | ~5372–5398 | Reservas (API existe; UI coming soon) |
| `InventoryCountSession` / Line | ~5400–5445 | Conferência |
| `InventoryAuditLog` | ~5447–5463 | Auditoria (UI coming soon) |

**Migration:** `prisma/migrations/20260627120000_inventory_module_base`.

### 3.3 Nomus — estoque, NF-e, OP, AP, BOM

| Modelo | Linhas | Papel |
|--------|--------|-------|
| `NomusStockDocument` (+ Item) | L2602–2676 | Stage `documentosEstoque`; `idNfe` |
| `NomusNfe` (+ fiscal) | ~2848–3006 | Stage NF-e; `isFornecedor` |
| `NomusProductionOrder` (+ sales link) | ~2486–2598 | OP |
| `NomusAccountsPayable` | ~2330–2409 | AP read-only sync |
| `NomusProductCatalog` / BOM stage / apply | ~2165–2247, 3352+ | Engenharia |

**Migrations (amostra):**  
`20260710180000_nomus_stock_documents`, `20260731120000_nomus_stock_document_header_enrichment`, `20260616120000_nomus_nfes`, `20260728120000_nomus_production_orders`, `20260607120000_nomus_accounts_payable`.

### 3.4 Fornecedores e CCs financeiros

| Modelo | Linhas | Papel |
|--------|--------|-------|
| `FinancialSupplier` (+ Alias) | L4725–4754, 4915+ | Cadastro oficial AP |
| `FinancialCostCenter` + rules/allocations | ~4939–5091 | Motor financeiro (separado de `CostCenter`) |

### 3.5 Inteligência de Mercado (não é cotação SC)

| Modelo | Linhas | Papel |
|--------|--------|-------|
| `MaterialMarketQuote` | L318–376 | Cotação de mercado |
| `MaterialMarketQuoteAttachment` | L410–427 | Anexos (`storageKey`) |
| `MaterialMarketPurchaseLink` | ~381–407 | Link manual; `purchaseOrderId` **sem FK** (comentário: sem módulo PO formal) |

### 3.6 Backup / não reutilizar como domínio

Tabelas `ProductBOM_backup_*` em `schema.prisma` L1765–1843+ — artefatos de remapeamento histórico. **Não** usar como fonte oficial de BOM.

---

## 4. Volume esperado e “tabelas vazias”

| Área | Volume esperado | Código depende? | Nota |
|------|-----------------|-----------------|------|
| `Material` / `Product` / `ProductBOM` | Alto (produção) | **Sim** | Núcleo engenharia/comercial |
| `NomusStockDocument` / `NomusNfe` / OP / AP | Alto (sync) | **Sim** | Scripts + UIs comerciais/financeiras |
| `PurchaseRequest*` | Baixo–médio | **Sim** | UI `/purchases` + APIs `server.ts` |
| `Inventory*` | Baixo se MVP pouco adotado; schema pronto | **Sim** | Rotas/serviços/testes `test:inventory` mesmo com 0 rows |
| `InventoryReservation` UI | — | API **sim**, UI **não** (coming soon) | `inventoryNavigation.ts` L73–85 |
| `PurchaseOrder` / Recebimento / Cotação SC | N/A (não existem) | — | Soft refs em Inventory/MI |

**Confirmação de emptiness em produção:** fora do alcance deste OP (OP-00 §10). Qualquer “vazio” aqui é **hipótese de adoção**, não contagem.

---

## 5. APIs, UI, rotas e navegação

### 5.1 Navegação

Grupo **Cadeia de Suprimentos** — `src/lib/navigationGroups.ts` L168–171: `materials`, `purchases`, `inventory`.

### 5.2 Rotas SPA (`src/App.tsx`)

| Rota | Módulo | Escopo real |
|------|--------|-------------|
| `/materials/*` | Materials + MI | Cadastro MP + mercado |
| `/purchases`, `/purchases/indicators` | `PurchaseModule` | **Só solicitações** |
| `/inventory/*` | `InventoryModule` | Almoxarifado local |
| `/products/*` | `ProductModule` | Engenharia |
| `/production-orders` | OPs | Read-only Nomus |
| `/output-documents` | Documentos de saída | Stage stock **saída** |
| `/finance/suppliers` | Fornecedores AP | Financeiro |

### 5.3 APIs (evidência)

| Domínio | Registrar / local | Paths principais |
|---------|-------------------|------------------|
| Inventory | `src/lib/inventoryRoutes.ts` → `registerInventoryRoutes` | `/api/inventory/{dashboard,items,warehouses,balances,movements,reservations,count-sessions*}` |
| Purchases | `server.ts` (~handlers purchase-requests / cost-centers) | `/api/purchase-requests*`, `/api/cost-centers*` |
| Materials/MI | `server.ts` + attachment routes | `/api/materials*`, `/api/materials/market-intelligence/*`, anexos de quote |
| Products/BOM/Nomus eng. | `server.ts` `/api/products*`, `/api/nomus/*` | CRUD + BOM compare/apply |
| Suppliers finance | `src/lib/financeSuppliersRoutes.ts` | `/api/finance/suppliers*` |
| OPs | `src/lib/productionOrdersRoutes.ts` | `/api/operations/production-orders*` |
| Output docs | `outputDocumentsRoutes` | `/api/commercial/output-documents*` (DocumentoSaida) |

---

## 6. Permissões

### Canônicas (`src/lib/permissionsClient.ts`)

- Suprimentos / MI: L68–75, catalog L456+.
- Estoque: `operations.inventory` (+ items/warehouses/movements/counts) L104–108, L702+.
- Compras: `operations.purchases` L109.
- Produtos: `engineering.products` (+ tabs BOM etc.).
- Fornecedores: `finance.suppliers`.
- OPs: `operations.production_orders`.

### Legado (`permissionCatalog.ts`)

Ainda existem chaves `materials.*`, `inventory.*`, `purchases.*`, `products.*` usadas como aliases/personas (ex.: `analistaCompras.perm43.test.ts`).

### Contrato

`src/lib/security/permissionContract/resources.ts` — output-documents nota stage DocumentoSaida (~L864).

---

## 7. Feature flags

| Flag | Valor | Arquivo | Efeito |
|------|-------|---------|--------|
| `INVENTORY_INTEGRATIONS_ENABLED` | `false` | `src/lib/inventory/inventoryIntegrationTypes.ts` L10 | Bloqueia orquestração estoque↔outros módulos |
| Flags dedicadas PO/recebimento/entrada | **Não encontradas** | — | Novos módulos devem nascer com flag **off** (OP-00 §7) |
| Sales-order-flow / projects | Outros domínios | — | Não cobrem SC compras |

Documentação: `docs/inventory-future-integrations.md` L1–6; `docs/inventory-module-architecture.md`.

---

## 8. Integrações Nomus e jobs

| Job / script | Alvo | Default / filtro |
|--------------|------|------------------|
| `sync:nomus:stock-documents:*` | `NomusStockDocument` | Tipo default **`DocumentoSaida`** (`nomusStockDocumentsSyncLogic.ts` L11) |
| `sync:nomus:nfes:*` | `NomusNfe` | Billing **descarta entrada** (`nomusNfeBillingEligibility` — motivos `fornecedor_entrada`, `tipo_operacao_entrada`, …) |
| `sync:nomus:products:*` / BOM / master-data | Catálogo/BOM | Engenharia |
| `sync:nomus:production-orders:*` | OPs | Operações |
| Sync MP-only dedicado | — | MP entra via master-data/produtos/BOM |

**Documento de entrada / NF-e de entrada como produto SC:** não productizado. Stage pode armazenar payloads conforme sync genérico, mas o produto IndusCost atual é **saída**-centrado (output-documents + billing).

---

## 9. Infraestrutura de anexos

| Peça | Path | Uso |
|------|------|-----|
| Storage local | `src/lib/appLocalFileStorage.ts` (`saveAppLocalFile`, `data/uploads/` / `APP_UPLOADS_DIR`) | Genérico app |
| Anexos cotação MI | `materialMarketQuoteAttachmentRoutes.ts` + `MaterialMarketQuoteAttachment` | Namespace `material-market-quotes`, multer ~20MB |
| UI | `MaterialMarketQuoteAttachmentsPanel.tsx` | MI |
| Fleet attachments | Separado | Fora de SC |
| Anexos SC (PO/recebimento/SC) | **Não existem** | Reaproveitar padrão MI + storage local |

---

## 10. Testes e scripts (amostra)

- Inventory: `npm run test:inventory`; `inventoryRoutes.test.ts`, `inventoryService.test.ts`, `inventoryIntegrations.test.ts`.
- MI: `test:market-intelligence`.
- Stock docs / output docs: `test:nomus:stock-documents`, `test:output-documents:*`.
- NFes: `test:nomus:nfes`.
- OPs: `test:nomus:production-orders`, `test:production-orders-api|page`.
- Personas compras: `analistaCompras.perm43.test.ts`.

---

## 11. Estruturas vazias / pouco usadas **reaproveitáveis**

1. **`InventoryWarehouse` / `Location` / `Balance` / `Movement` / `Item`** — schema + API + UI prontos; mesmo se DB local estiver vazio, o código **depende** deles. Preferir evoluir aditivamente a criar paralelo “Almoxarifado2”.
2. **`InventoryReservation` (+ API)** — backend existe; UI em `comingSoon` (`inventoryNavigation.ts` L73–77). Completar UI em vez de novo modelo.
3. **`PurchaseRequest` / `PurchaseRequestItem` / `CostCenter` (compras)** — base de SC; estender para cotação/PO/recebimento com **novas** tabelas aditivas, sem reescrever SC.
4. **Soft refs** em `InventoryMovement` (`purchaseOrderId`, `nfeId`, …) — contratos futuros já esboçados em `docs/inventory-future-integrations.md`.
5. **`FinancialSupplier`** — identidade de fornecedor oficial para SC (leitura/vínculo).
6. **Padrão de anexos MI + `appLocalFileStorage`** — template para evidências SC.

---

## 12. Estruturas que **não** devem ser reutilizadas (como dono SC)

| Estrutura | Motivo |
|-----------|--------|
| `MaterialMarketQuote*` como “cotação de compra” | Domínio MI/preço de MP; governança distinta de rodada SC |
| `ProductBOM_backup_*` | Snapshots de remapeamento; não fonte de verdade |
| Mutar `Material`/`Product`/`ProductBOM` via recebimento | Viola OP-00 §§1–2,5 |
| Atualizar custo publicado / preço / BOM / AP a partir de SC | OP-00 §5 |
| Tratar `NomusNfe` entrada + billing path como recebimento | Descarte de entrada no billing; não há fluxo de conferência física |
| `CostCenter` (compras) ↔ `FinancialCostCenter` como se fossem o mesmo | Dois motores; risco de classificação errada |
| Output-documents / DocumentoSaida como “documento de entrada” | Produto é saída comercial |
| Fleet attachments | Domínio distinto |

---

## 13. Fontes oficiais (por entidade)

| Necessidade SC | Fonte oficial | Como consumir (fase 1) |
|----------------|---------------|------------------------|
| MP / item engenharia | `Material`, `Product` | Read / FK |
| Estrutura | `ProductBOM` (+ stage Nomus para auditoria) | Read |
| Fornecedor | `FinancialSupplier` (+ aliases Nomus) | Read / link |
| CC financeiro AP | `FinancialCostCenter` | Read se necessário |
| CC operacional SC/estoque | `CostCenter` | Read/write só no escopo compras/estoque local |
| Documento estoque Nomus | `NomusStockDocument` | Read (atenção ao tipo) |
| NF-e | `NomusNfe` | Read; não mutar |
| OP | `NomusProductionOrder` | Read |
| AP | `NomusAccountsPayable` | Read |
| Saldo físico local | `InventoryBalance` via movimentos | Dono SC |
| SC (solicitação) | `PurchaseRequest*` | Dono SC |

---

## 14. Riscos

1. **Dois CCs** — confusão operacional vs financeiro.  
2. **Soft `purchaseOrderId`** sem modelo PO — risco de IDs órfãos se PO for criado depois sem migração de vínculo.  
3. **Ativar `INVENTORY_INTEGRATIONS_ENABLED` cedo demais** — pode acoplar PV/OP/compras ao saldo sem recebimento.  
4. **Usar MI quotes como SC** — misturar governança de preço com compra.  
5. **Assumir stock Nomus = almoxarifado local** — são camadas diferentes (stage vs MVP local).  
6. **Entrada Nomus não productizada** — sync genérico ≠ fluxo de recebimento IndusCost.  
7. **UI reservas/auditoria coming soon** enquanto API existe — divergência de expectativa.  
8. **Sem acesso a volume real** nesta auditoria — planejar capacity com métricas de ops.

---

## 15. Gaps (greenfield aditivo)

Prioridade sugerida (não implementado neste OP):

1. Pedido de compra (modelo + API + flag).  
2. Cotação / rodadas de negociação SC (distintas de MI).  
3. Recebimento / conferência → `PURCHASE_ENTRY` (já tipado em `InventoryMovementType`).  
4. Evidências/anexos SC.  
5. Indicadores próprios SC.  
6. UI de reservas/auditoria inventory (ligar ao que já existe).  
7. Política clara DocumentoEntrada (se/quando sync Nomus de entrada for produto).

---

## 16. Recomendação inicial de reaproveitamento

1. **Tratar `Inventory*` como o almoxarifado oficial local** da SC; não criar segundo warehouse stack.  
2. **Manter `PurchaseRequest*`** como porta de demanda; PO/cotação/recebimento = tabelas **novas aditivas**.  
3. **Vincular itens logísticos a `Product`/`Material` por ID** (`InventoryItem.productId`, `PurchaseRequestItem.materialId`) — sem cadastro paralelo.  
4. **Fornecedor = `FinancialSupplier`** (leitura/vínculo).  
5. **Não ligar** SC a mutação de BOM/custo/preço/AP/Nomus estoque oficial.  
6. **Manter `INVENTORY_INTEGRATIONS_ENABLED = false`** até recebimento e contratos estarem testados.  
7. **Anexos:** copiar padrão MI (`storageKey` + `appLocalFileStorage`).  
8. **Feature flags off** para qualquer UI/rota nova (OP-00 §7).  
9. **Nomus stock/NFe/OP:** consumidores read-only para auditoria/cruzamento; não fonte de saldo local até regra explícita.  
10. Respeitar checklist OP-00 §8 em cada OP seguinte.

---

## 17. Evidências por arquivo (índice rápido)

| Tema | Evidência |
|------|-----------|
| Cadeado permanente | `.cursor/rules/supply-chain-guardrails.mdc` |
| Grupo menu SC | `src/lib/navigationGroups.ts` L168–171 |
| Flag integrações estoque | `src/lib/inventory/inventoryIntegrationTypes.ts` L10, L118–119 |
| Docs integrações futuras | `docs/inventory-future-integrations.md` L1–24 |
| Nav inventory coming soon | `src/components/inventory/inventoryNavigation.ts` L73–85 |
| Schema inventory | `prisma/schema.prisma` L5111+, L5237+, L5279+ |
| Schema purchases | `prisma/schema.prisma` L1436–1496 |
| Schema Nomus stock | `prisma/schema.prisma` L2602–2676 |
| Schema suppliers | `prisma/schema.prisma` L4725+ |
| Tipo default stock sync | `src/lib/nomusStockDocumentsSyncLogic.ts` L11 |
| Permissões estoque/compras | `src/lib/permissionsClient.ts` L104–109, L702+ |
| Anexos MI | `MaterialMarketQuoteAttachment` L410–427; `appLocalFileStorage.ts` |
| Teste flag off | `src/lib/inventoryIntegrations.test.ts` L27 |

---

## 18. Conclusão OP-01

O IndusCost **já possui** motores oficiais maduros (MP, produto, BOM, MI, financeiro, Nomus saída/OP/AP) e um **MVP de estoque/almoxarifado local** com solicitações de compra. Faltam, como produto de SC: **PO, cotação de compra, recebimento, anexos SC e indicadores próprios**. A evolução deve ser **aditiva**, reusando `Inventory*` + `PurchaseRequest*` + IDs oficiais, sem mutar módulos protegidos.

**Próximo passo sugerido (fora deste OP):** OP de desenho de modelo aditivo (PO/cotação/recebimento) + matriz de permissões/flags, ainda sem implementação de escrita nos protegidos.
