# Arquitetura genérica de setores de estoque (Stock Collector)

**Status:** auditoria (§1–11) + fundação e motor STANDARD implementados (§12)  
**Branch de trabalho:** `docs/inventory-stock-sector-architecture`  
**Baseline HEAD:** `a383d7a8ad1b224df80383131f28b915857c974d`  
**Data da auditoria:** 2026-10-06  

## 1. Objetivo

Permitir cadastrar novos setores de estoque no IndusCost (sem alterar código / deploy só para criar setor), preservando **100%** dos fluxos atuais de:

| Setor legado | Código | Prefixo sessão | Slug QR |
|---|---|---|---|
| Matéria-prima | `RAW_MATERIAL` | `MP` | `raw-material` |
| Componentes | `COMPONENT` | `CP` | `componentes` |
| Produto acabado | `FINISHED_PRODUCT` | `PA` | `produto-acabado` |

A nova arquitetura entra **aditivamente**. Primeiro consumidor previsto:

- `itemType = ADMINISTRATIVE_SUPPLY`
- warehouse `ADMINISTRATIVO` (já em homologação; ~311 itens ACTIVE, `controlsStock=true`, sem saldo oficial ainda)
- `strategy = STANDARD`

## 2. Fluxo atual (as-is)

### 2.1 Cadeia canônica (inalterável neste desenho)

```
QR setor → celular autenticado (device registry / Tailscale peer)
  → Contagem OU Retirada
  → InventoryCountSession / InventoryCountLine  (contagem)
     → finalize → apply-adjustments
     → InventoryMovement (POSITIVE/NEGATIVE_ADJUSTMENT)
     → InventoryBalance (projeção)
  → InventoryMovement REQUISITION_EXIT (retirada)
     → InventoryBalance
```

Autoridade de fatos: **InventoryMovement**.  
Projeção de saldo: **InventoryBalance**.  
Não há ledger paralelo nem contagem paralela.

### 2.2 Contrato de setores (hardcoded)

Fonte única de verdade de setor hoje: `src/lib/inventory/collector/collectorSectorContract.ts` → `COLLECTOR_SECTORS`.

- `parseCollectorSector` aceita **somente** os 3 códigos/slugs acima.
- Labels, slugs e `sessionCodePrefix` vivem nesse mapa.
- UI QR deriva de `COLLECTOR_SECTOR_QR_OPTIONS` (`collectorSectorQrUi.ts`).
- Rota SPA: `/collector/sector/:sectorSlug` (`App.tsx` → `CollectorSectorPage`).

### 2.3 Dois motores de sessão (dispatch explícito)

Em `collectorRoutes.server.ts`, `POST /api/inventory/collector/count-sessions`:

| Condição | Função | Prepare | População de linhas |
|---|---|---|---|
| `isCollectorProductSector(sector)` | `createAndStartCollectorProductSectorSession` | não cria InventoryItem | `populateProductSectorCountLines` |
| senão (hoje só MP) | `createAndStartCollectorSectorSession` | `prepareRawMaterialSectorForCounting` (cold-start Material→Item) | `populateRawMaterialCountLines` |

Mesmo padrão no GET de contexto / warehouses / active session.

### 2.4 Elegibilidade de itens

`collectorSectorEligibility.ts`:

| Setor | Predicado |
|---|---|
| `RAW_MATERIAL` | `ACTIVE` + `itemType=RAW_MATERIAL` + `materialId ≠ null` + `controlsStock` |
| `COMPONENT` | `ACTIVE` + `itemType=COMPONENT` + `productId ≠ null` + `controlsStock` |
| `FINISHED_PRODUCT` | `ACTIVE` + `itemType=FINISHED_PRODUCT` + `productId ≠ null` + `controlsStock` |

**ADMINISTRATIVE_SUPPLY** não entra em nenhum predicado. Itens admin tipicamente **não** têm `materialId` nem `productId`.

### 2.5 Resolução de warehouse

| Caminho | Regra |
|---|---|
| MP (`resolveCollectorSectorOperationalContext`) | Warehouses com presença (balance **ou** `defaultWarehouseId`) do predicado MP; se vazio, **fallback** para todos ACTIVE |
| CP/PA (`resolveCollectorProductSectorOperationalContext`) | Só warehouses com presença; **sem** fallback para todos ACTIVE → `CONFIGURATION_REQUIRED` |

### 2.6 Identidade de setor na sessão

`InventoryCountSession` **não tem coluna de setor**.

Compatibilidade (`collectorSessionCompatibility.server.ts`):

1. Com linhas: todas devem ter `itemType` do setor (`COLLECTOR_SECTOR_ITEM_TYPE`).
2. Prefixo do `code` (`MP-` / `CP-` / `PA-` + `YYYYMMDD` + seq) é sinal auxiliar.
3. Sessão incompatível → `COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE` (409); **nunca** abre segunda COUNTING no mesmo warehouse.

Regex de prefixo Collector: `^([A-Z]{2})-\d{8}-\d+$` (prefixo **exatamente 2 letras**).

### 2.7 Contagem (já genérica no ledger)

- Lista cega de itens (`listCollectorSessionItemsBlind`) — não revela `systemQuantity`.
- Contagem / finalize / apply-adjustments usam motores canônicos de count → movimentos de ajuste → balance.
- Justificativa device: `COLLECTOR_DEVICE_JUSTIFICATION`.

### 2.8 Retirada (específica de MP)

- UI: `withdrawalEnabled` só se `sector === "RAW_MATERIAL"` (`CollectorSectorPage.tsx`).
- API/serviço: `listCollectorWithdrawItems` / `withdrawCollectorMaterial` recusam qualquer setor ≠ `RAW_MATERIAL`.
- Filtro de item = predicado MP; movimento fixo `REQUISITION_EXIT` via `createInventoryMovementInTx`.
- **Não envia `costCenterId`.**

### 2.9 QR / deep-link / device

- QR de setor: deep-link fixo `/collector/sector/<slug>` sobre `INVENTORY_COLLECTOR_PUBLIC_BASE_URL` (sem token).
- Admin UI: Estoque → Dispositivos do Coletor → emitir QR (`GET /api/inventory/collector/sector-qr`).
- Autenticação: enrollment Tailscale → aprovação → `requireInventoryCollectorDevice` nas rotas operacionais.
- QR de **item** (etiqueta warehouse×location) permanece legado separado (`collectorQrContract`).

### 2.10 Partes já genéricas hoje

- Modelos Prisma: `InventoryItem`, `InventoryWarehouse`, `InventoryLocation`, `InventoryBalance`, `InventoryMovement`, `InventoryCountSession/Line`, `InventoryCollectorDevice`.
- Enum `InventoryItemType` já inclui `ADMINISTRATIVE_SUPPLY`, `PPE`, `MAINTENANCE`, `TOOLING`, `PACKAGING`, etc.
- Motor de movimento / balance / count adjustments (ledger).
- Device registry, enrollment, capabilities, audit logs de collector.
- SPA collector por slug (estrutura de página única).
- Carga inicial administrativa (preview/apply catalog-only) — fora do Collector, mas prepara itens.

### 2.11 Específico de MP

- Cold-start Material → InventoryItem (`prepareRawMaterialSectorForCounting`).
- População que exige `materialId`.
- Fallback de warehouse para todos ACTIVE.
- Retirada completa.
- Reconciliação `Material.quantity` após movimentos com `materialId`.

### 2.12 Específico de Product (CP/PA)

- Sem criação de item no prepare.
- Exige `productId`.
- Warehouse só por presença.
- Mensagens UI (`collectorProductSectorMessages.ts`).
- Ajustes de contagem compartilhados com fluxo de sessão product.

## 3. Pontos de acoplamento (mapa)

| # | Onde | O que está hardcoded |
|---|---|---|
| 1 | `collectorSectorContract.ts` | Setores, labels, slugs, prefixos |
| 2 | `collectorSectorEligibility.ts` | `itemType` + `materialId`/`productId` |
| 3 | `COLLECTOR_SECTOR_ITEM_TYPE` | Mapa setor → itemType |
| 4 | `isCollectorProductSector` | Dispatch binário CP/PA vs MP |
| 5 | `createAndStartCollectorSectorSession` | Sempre prepare/populate MP |
| 6 | `collectorProductSectorCounting.server.ts` | Prepare/populate product |
| 7 | Warehouse resolvers | Regras distintas MP vs product |
| 8 | `collectorWithdrawal.server.ts` | Gate `RAW_MATERIAL` + predicado MP |
| 9 | `CollectorSectorPage.tsx` | `withdrawalEnabled === RAW_MATERIAL`; parse legado |
| 10 | `collectorSectorQrUi.ts` / QR section | Opções só do contrato |
| 11 | Enrollment sector context | Normaliza via `COLLECTOR_SECTORS` |
| 12 | Session code generators | Prefixo do contrato |
| 13 | Testes de contrato | Assertam exatamente 3 setores / slugs / prefixos |

## 4. Premissas perigosas / incompatibilidades estruturais

### 4.1 [BLOQUEIO RETIRADA] Centro de custo obrigatório

`INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES` inclui `ADMINISTRATIVE_SUPPLY` (também PPE, MAINTENANCE, etc.).  
`REQUISITION_EXIT` sem `costCenterId` falha com `COST_CENTER_REQUIRED`.

O Collector **não** coleta nem envia centro de custo na retirada.

**Consequência:** o primeiro consumidor **não** pode habilitar retirada STANDARD sem uma destas decisões (próximo passo de produto):

1. UI Collector + API com `costCenterId` (ou default no setor), ou  
2. `allowsWithdrawal=false` no setor ADMINISTRATIVO até haver regra, ou  
3. Exceção auditada (não recomendado).

**Recomendação desta auditoria:** v1 STANDARD = **contagem primeiro**; retirada em fase seguinte.

### 4.2 [NÃO REUTILIZAR MP PREPARE]

`prepareRawMaterialSectorForCounting` cria/vincula a partir de **Material**.  
Itens admin já existem como `InventoryItem` sem `materialId`. Reusar prepare MP quebraria semanticamente e poderia criar lixo.

**STANDARD deve seguir o padrão product** (só presença + populate de itens já existentes), **sem** exigir `productId`/`materialId`.

### 4.3 [IDENTITY LINK]

Predicados atuais amarram estoque a cadastro oficial (Material/Product).  
Itens `ADMINISTRATIVE_SUPPLY` são identidade logística própria (`code`/`description` no InventoryItem).  
Elegibilidade STANDARD: `status=ACTIVE` + `itemType=<setor.itemType>` + `controlsStock=true` (+ opcional filtro warehouse).

### 4.4 [PREFIXO 2 LETRAS]

Compatibilidade e geradores assumem prefixo `[A-Z]{2}`.  
Novos setores precisam de `sessionCodePrefix` único de 2 letras (ex.: `AD` para Administrativo). Não usar códigos de 3+ caracteres sem alterar o contrato de sessão.

### 4.5 [Tabela vazia = legado intacto]

Se `InventoryStockSector` não tiver linhas, MP/CP/PA **devem** continuar 100% no caminho atual. Qualquer resolução de setor deve:

1. Tentar match legado `COLLECTOR_SECTORS` **primeiro** (ou em paralelo sem depender de DB),  
2. Só consultar DB para códigos/slugs **não** legado.

### 4.6 [warehouseId no setor vs multi-warehouse legado]

Modelo alvo liga setor → um `warehouseId`.  
MP/CP/PA hoje podem operar em múltiplos warehouses por presença.  
**Não migrar** legado para 1:1 nesta fase. `warehouseId` obrigatório só para `strategy=STANDARD`.

### 4.7 [Sessão sem coluna setor]

Continuar identidade por `itemType` das linhas + prefixo.  
Opcional futuro (fora do escopo fundação mínima): coluna `sectorId` nullable — **não** obrigatória para v1 se `itemType` do STANDARD for exclusivo (ex. `ADMINISTRATIVE_SUPPLY`).

### 4.8 [Saldo zero]

311 itens admin sem balance: contagem product-like já trata ausência de balance como `systemQuantity=0` e cria linhas a partir de `defaultWarehouseId`. Adequado para implantação via contagem/ajustes — **não** inventar saldo na entidade setor.

## 5. Arquitetura proposta

### 5.1 Entidade `InventoryStockSector` (aditiva)

```text
InventoryStockSector
  id                    Uuid PK
  code                  String UNIQUE   // ex.: ADMINISTRATIVO, EPI
  name                  String
  slug                  String UNIQUE   // URL: /collector/sector/{slug}
  status                ACTIVE | INACTIVE

  warehouseId           Uuid FK → InventoryWarehouse   // obrigatório p/ STANDARD
  strategy              STANDARD | RAW_MATERIAL | PRODUCT
  itemType              InventoryItemType              // ex.: ADMINISTRATIVE_SUPPLY

  sessionCodePrefix     String(2) UNIQUE               // ex.: AD
  allowsCounting        Boolean @default(true)
  allowsWithdrawal      Boolean @default(false)        // v1 admin: false até cost center

  createdAt / updatedAt
  createdByUserId / updatedByUserId
```

**Proibido nesta entidade:** saldo, ledger, cópia de itens, movimentos, sessões duplicadas.

**Ajuste pequeno recomendado vs. brief:**

- `strategy` enum com valores `STANDARD | RAW_MATERIAL | PRODUCT` (espelha LEGACY/SPECIAL vs GENERIC).
- Linhas com `strategy` RAW_MATERIAL/PRODUCT **não** são necessárias na v1 (legado fica no código). Se no futuro existirem, devem ser **espelho read-only** — nunca fonte de verdade que desligue o contrato hardcoded.
- Índice único `(itemType, warehouseId)` onde `status=ACTIVE` e `strategy=STANDARD` (evita dois setores STANDARD ativos no mesmo almoxarifado/tipo).

### 5.2 Resolução de setor (runtime)

```text
resolveCollectorSectorRef(input):
  1. Se parse legado COLLECTOR_SECTORS ok → { kind: LEGACY, code, strategy: derivado }
  2. Senão buscar InventoryStockSector ACTIVE por code|slug
       → { kind: GENERIC, strategy: STANDARD, ...row }
  3. Senão COLLECTOR_INVALID_SECTOR
```

Legado **nunca** depende da tabela.

### 5.3 Dispatch por strategy

| Strategy | Prepare | Populate | Warehouse | Withdrawal |
|---|---|---|---|---|
| `RAW_MATERIAL` (legado) | cold-start Material | MP lines | presença + fallback ACTIVE | sim (atual) |
| `PRODUCT` (legado CP/PA) | no-op itens | product lines | presença only | não |
| `STANDARD` (DB) | no-op itens | genérico por `itemType` + warehouse do setor | **fixado** em `sector.warehouseId` | só se `allowsWithdrawal` **e** cost-center resolvido |

Novo módulo sugerido (fundação):  
`collectorStandardSectorCounting.server.ts` — espelhar populate product **sem** `productId`, filtrando `itemType` + presença no `warehouseId` do setor.

Reutilizar:

- `createInventoryMovementInTx` / apply count adjustments  
- device auth, enrollment, blind list, finalize  
- QR absolute URL helpers  
- session lock / compatibility (estender mapa itemType↔setor para GENERIC via DB `itemType` + prefix)

### 5.4 QR e UI

- Deep-link continua `/collector/sector/:slug`.
- Lista de QR admin = legado ∪ setores ACTIVE `allowsCounting` (ou todos ACTIVE).
- `CollectorSectorPage` resolve label/flags via API de contexto (não só `COLLECTOR_SECTORS`).

### 5.5 Admin CRUD (fase posterior à fundação schema)

Cadastro IndusCost: code, name, slug, warehouse, itemType, prefix, flags.  
Sem editar código. Feature flag / permissão canônica (padrão do projeto).

## 6. Estratégia de rollout

| Fase | Escopo | Critério de aceite |
|---|---|---|
| **0 — este doc** | Auditoria + baseline | Documento + testes registrados |
| **1 — fundação** | Migration aditiva + model Prisma + repositório read; **zero** mudança de comportamento Collector | `InventoryStockSector` vazia; suite inventory igual ao baseline |
| **2 — STANDARD counting** | Resolver setor DB; populate/session STANDARD; seed setor ADMINISTRATIVO → warehouse ADMINISTRATIVO; QR; `allowsWithdrawal=false` | Contagem admin gera movimentos/balances; MP/CP/PA intactos |
| **3 — UI cadastro** | CRUD setores + emissão QR dinâmica | Criar EPI/etc. sem deploy de código de setor |
| **4 — withdrawal** | Cost center no fluxo Collector ou default de setor | Retirada STANDARD segura |

**Seed inicial (fase 2, não 1):** uma linha `ADMINISTRATIVO` / slug `administrativo` / prefix `AD` / `itemType=ADMINISTRATIVE_SUPPLY` / `strategy=STANDARD` / `allowsCounting=true` / `allowsWithdrawal=false`.

**Não** backfill MP/CP/PA.

## 7. Estratégia de rollback

| Camada | Rollback |
|---|---|
| Migration | Aditiva: dropar tabela só se vazia e nunca referida; sem ALTER destrutivo em tabelas canônicas |
| Código Collector | Feature flag `INVENTORY_STOCK_SECTOR_GENERIC_ENABLED` (default **false**): com flag off, só legado |
| Seed STANDARD | Soft-delete / `status=INACTIVE` remove setor do QR e do parse genérico |
| Dados ledger | Movimentos/balances criados por contagem STANDARD **permanecem** (são canônicos); não apagar |

Rollback operacional: desativar flag + inativar setor → celulares voltam a só ver QRs legados.

## 8. Arquivos previstos (implementação futura — não neste passo)

### 8.1 Fundação (fase 1)

- `prisma/schema.prisma` — model + enums
- `prisma/migrations/<ts>_inventory_stock_sector/migration.sql` — CREATE TABLE only
- `src/lib/inventory/collector/inventoryStockSector*.ts` — types, repo read, resolve
- testes de schema/repo (vazia ⇒ legado)

### 8.2 STANDARD counting (fase 2)

- `collectorStandardSectorCounting.server.ts` (novo)
- `collectorRoutes.server.ts` — dispatch ternary LEGACY_MP / LEGACY_PRODUCT / STANDARD
- `collectorSessionCompatibility.server.ts` — prefix/itemType genéricos
- `collectorSectorContract.ts` — **manter** legado; helpers de merge com DB
- `collectorSectorQrUi.ts` + `InventoryCollectorSectorQrSection`
- `CollectorSectorPage.tsx` / `collectorClient.ts`
- `inventoryRoutes.ts` (QR admin)
- testes: standard counting + regressão MP/CP/PA + withdrawal ainda só MP

### 8.3 Explicitamente fora / não tocar sem autorização

- Motores protegidos (BOM, custos, Nomus stock oficial, Contas a Pagar, etc.)
- DROP/RENAME em Inventory*
- Migrar RAW_MATERIAL / COMPONENT / FINISHED_PRODUCT para a tabela
- Novo tipo de movimento ou nova tabela de saldo

## 9. Riscos de regressão

| Risco | Mitigação |
|---|---|
| `parseCollectorSector` passar a exigir DB | Sempre resolver legado sem query |
| Dispatch cair no prepare MP para STANDARD | Gate explícito por `strategy` |
| Prefixo colidir com MP/CP/PA | UNIQUE + validação contra `COLLECTOR_SECTORS` |
| Segunda COUNTING no mesmo warehouse (admin + MP) | Manter lock + compatibility por itemType |
| Retirada admin sem cost center | `allowsWithdrawal=false` até fase 4 |
| Testes de contrato que fixam “só 3 setores” | Atualizar gradualmente: legado continua 3; genéricos são aditivos |
| QR slug inválido | UNIQUE slug + normalize |

## 10. Baseline técnico (2026-10-06)

Ambiente local (Windows). **Sem deploy, sem migration em banco compartilhado, sem alteração de produção.**

### 10.1 Testes `npm run test:inventory`

| Métrica | Valor |
|---|---|
| tests | **876** |
| pass | **875** |
| fail | **1** |
| cancelled / skipped / todo | 0 |
| exit | 1 |

**Falha preexistente (não mascarada):**

- Arquivo: `src/lib/inventoryUx.test.ts` — caso `"12. dashboard KPIs fazem drill-down"`
- Expectativa: regex `/\/inventory\/balances\?belowMinimum=1/`
- Realidade: `InventoryDashboardTab.tsx` **não** contém mais esse drill-down query (`belowMinimum` ausente no componente)
- Natureza: **UX / contrato de teste desatualizado**, fora do escopo Collector/setores
- **Não corrigida nesta missão** (evitar misturar escopos)

Demais suites do domínio inventory/collector (withdrawal, product sector, cold-start, QR, devices, administrative load, etc.) **passaram** neste baseline.

### 10.2 Typecheck `npx tsc --noEmit`

| Métrica | Valor |
|---|---|
| exit | **2** |
| erros reportados | **1443** (baseline do repositório; heap 8GB) |
| OOM sem heap extra | observado em tentativa inicial (`FATAL ERROR: heap out of memory`, exit 134) |

Erros **não** são introduzidos por este doc. Amostra em inventory (preexistente): typos `releasedByuserId` / `canceledByuserId` / `responsibleuserId` em `inventoryService.server.ts`; narrowing em `administrativeStockInitialLoadPreview.ts`; fixtures de auth incompletas em vários testes; etc.

### 10.3 Build `npm run build`

| Métrica | Valor |
|---|---|
| exit | **1** |
| causa | Rollup não resolve `leaflet/dist/leaflet.css` importado por `CustomerActivityLeafletMap.tsx` |

**Preexistente**, fora do domínio Inventory/Collector. Não mascarado.

### 10.4 Escopo deste passo

- ✅ Documento técnico criado  
- ✅ Baseline registrado com falhas honestas  
- ❌ Sem refactor amplo Collector  
- ❌ Sem migration aplicada  
- ❌ Sem deploy / produção  

## 11. Próximo prompt (fundação)

1. Branch dedicada a partir de main atualizada.  
2. Migration aditiva `InventoryStockSector` apenas.  
3. Camada de leitura + `resolveCollectorSectorRef` com legado primeiro.  
4. Flag default off.  
5. Testes: tabela vazia ≡ comportamento atual; nenhum teste de MP/CP/PA quebrado.  
6. **Não** ligar STANDARD no Collector ainda (isso é fase 2).

## 12. Fase 2 — motor genérico STANDARD (implementado)

Entrou de forma aditiva; MP/CP/PA seguem nos fluxos próprios e não consultam `InventoryStockSector`.

| Peça | Arquivo |
|---|---|
| Resolução (legado sem banco → `InventoryStockSector` por slug, fail closed) | `collectorSectorResolve.server.ts` |
| Elegibilidade, população, sessão, contexto, capacidade de contagem por sessão | `collectorStandardSector.server.ts` |
| Compatibilidade por identidade (`itemType` + `sessionCodePrefix`) | `collectorSessionCompatibility.server.ts` |
| Retirada STANDARD (mesmo núcleo e mesmo motor da retirada de MP) | `collectorWithdrawal.server.ts` |
| Dispatch LEGACY × STANDARD decidido no servidor | `collectorRoutes.server.ts` |
| Testes | `collectorStandardSector.test.ts` |

Decisões que divergem das seções anteriores:

- **Prefixo de sessão: 2 a 4 letras** (§4.4 dizia exatamente 2). O caso real usa `ADM`; os legados continuam com 2. Com linhas, só prefixo de outro setor **conhecido** (legado ou outro `InventoryStockSector`) contradiz a sessão — prefixo desconhecido (`CF-` manual) segue valendo pelas linhas, como antes.
- **Sem feature flag** (§7 previa uma): tabela vazia ≡ legado intacto, e `status=INACTIVE` desliga o setor.
- **Almoxarifado fixo no setor**: `warehouseId` do cliente é opcional e só é aceito se coincidir.
- **Capacidades no servidor**: `allowsCounting=false` bloqueia abrir/consultar sessão e também contar/finalizar/aplicar em sessão já aberta (reconhecida pelo prefixo); `allowsWithdrawal=false` bloqueia lista e retirada.

### 12.1 Centro de custo (pendência de regra, não contornada)

O motor de movimentos exige `costCenterId` em saídas de `ADMINISTRATIVE_SUPPLY`, `MAINTENANCE`, `PPE`, `PRODUCTION_SUPPLY` e `OTHER` — inclusive `NEGATIVE_ADJUSTMENT`.

- **Retirada STANDARD**: a rota aceita `costCenterId` opcional (validado: existe e está ativo) e o repassa ao motor. Sem ele, setores desses tipos recebem `COST_CENTER_REQUIRED`. A tela do Collector ainda não coleta centro de custo.
- **Ajuste de contagem negativo** nesses tipos: `apply-adjustments` falha com `COST_CENTER_REQUIRED` (a conferência não informa centro de custo — vale também para a conferência manual). Implantação por contagem a partir de saldo zero (só ajustes positivos) funciona.

Enquanto a regra não for decidida, o setor ADMINISTRATIVO opera contagem de implantação; contagem com divergência negativa e retirada pelo tablet dependem dessa decisão.

---

*Documento preparado para implementação incremental. Qualquer desvio que force MP/CP/PA a depender de `InventoryStockSector` deve ser rejeitado em review.*
