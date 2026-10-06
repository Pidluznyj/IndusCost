# Arquitetura genérica de setores de estoque (Stock Collector)

**Status:** auditoria (§1–11) + feature implementada, pronta para homologação (§12)  
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

## 12. Arquitetura final (implementada)

As seções 1–11 são a auditoria original. Esta seção descreve o que foi entregue e prevalece onde houver diferença.

### 12.1 Visão geral

```
Estoque → Setores / Collector (admin)
   InventoryStockSector  ── configuração: almoxarifado + tipo de item + operações + centro de custo
        │  QR fixo: <base pública do Collector>/collector/sector/<slug>
        ▼
Celular autorizado (Tailscale + Device Registry) lê o QR
        │  servidor resolve o setor pelo slug e decide a strategy
        ├─ LEGADO (MP / CP / PA) → fluxos de sempre, sem consultar a tabela de setores
        └─ STANDARD → motor genérico
              ├─ CONTAGEM: InventoryCountSession / Line → recordInventoryCount → finalize
              │            → generateInventoryCountAdjustments → InventoryMovement → InventoryBalance
              └─ RETIRADA: executeCollectorWithdrawal → createInventoryMovementInTx
                           (REQUISITION_EXIT) → InventoryBalance
```

`InventoryMovement` continua sendo o fato; `InventoryBalance` é projeção e só é escrito pelo motor de movimentos. O setor não guarda saldo, não copia itens e não movimenta nada.

| Peça | Arquivo |
|---|---|
| Regras de domínio do cadastro | `inventoryStockSectorDomain.ts`, `inventoryStockSectorValidation.ts` |
| Service do cadastro (CRUD, almoxarifado novo, prévia, opções) | `inventoryStockSectorService.server.ts` |
| Rotas admin | `inventoryRoutes.ts` (`/api/inventory/stock-sectors*`, `/api/inventory/collector/sector-qr`) |
| Tela admin | `InventoryStockSectorsTab.tsx`, `InventoryStockSectorFormSheet.tsx`, `InventoryStockSectorQrDialog.tsx`, `inventoryStockSectorForm.ts` |
| Resolução do setor (legado sem banco → tabela por slug) | `collector/collectorSectorResolve.server.ts` |
| Elegibilidade (regra única) | `collector/collectorStandardEligibility.ts` |
| População, sessão, contexto, capacidade por sessão, centro de custo | `collector/collectorStandardSector.server.ts` |
| Retirada STANDARD | `collector/collectorStandardWithdrawal.server.ts` (núcleo em `collectorWithdrawal.server.ts`) |
| Compatibilidade de sessão | `collector/collectorSessionCompatibility.server.ts` |
| Rotas do aparelho | `collector/collectorRoutes.server.ts` |
| Tela do celular | `CollectorSectorPage.tsx`, `collectorSectorMessages.ts`, `collectorClient.ts` |

### 12.2 STANDARD × legado

| | Legado (MP / CP / PA) | STANDARD |
|---|---|---|
| Onde é definido | Código (`collectorSectorContract.ts`) | Tabela `InventoryStockSector`, pela tela |
| Identidade do item | `materialId` / `productId` | O próprio `InventoryItem` (sem `materialId`/`productId`) |
| Almoxarifado | Por presença do item (pode haver vários) | Um, fixo no setor |
| Preparação | Cold-start de MP / diagnóstico de produto | Nenhuma: só lê itens existentes |
| Retirada | Só Matéria-prima, sem saldo na tela | Se `allowsWithdrawal`; saldo do servidor na tela |
| Depende da tabela de setores | Não | Sim |

Os tipos `RAW_MATERIAL`, `COMPONENT` e `FINISHED_PRODUCT`, os slugs `raw-material` / `componentes` / `produto-acabado` e os prefixos `MP` / `CP` / `PA` são reservados: o cadastro recusa e o resolvedor falha fechado.

### 12.3 Regras do setor STANDARD

- **Elegibilidade:** `status = ACTIVE` + `controlsStock = true` + `itemType = setor.itemType`.
- **Pertencimento:** `defaultWarehouseId = almoxarifado do setor` **ou** saldo já existente nesse almoxarifado. Como o tipo também é exigido, saldo de outro tipo no mesmo almoxarifado não entra.
- **Sessão:** identidade = `itemType` + `sessionCodePrefix` (2 a 4 letras). Código `<PREFIXO>-AAAAMMDD-NNN`, ex.: `ADM-20261006-001`. Uma conferência em contagem por almoxarifado; sessão incompatível responde 409 e nunca é escondida.
- **População:** 1 `count` + 2 leituras em lote + `createMany` em blocos de 1.000. Item sem saldo entra com `systemQuantity = 0`. Não cria saldo nem movimento. Idempotente.
- **Primeira contagem = implantação:** itens com saldo zero são contados; ao aplicar, o motor gera `POSITIVE_ADJUSTMENT` e o saldo passa a existir. Não há rotina de saldo inicial própria.
- **Capacidades (servidor):** `allowsCounting = false` bloqueia abrir/consultar sessão e também contar/finalizar/aplicar em sessão já aberta; `allowsWithdrawal = false` bloqueia lista e retirada.
- **Centro de custo:** o motor de movimentos exige centro de custo em saídas de `ADMINISTRATIVE_SUPPLY`, `MAINTENANCE`, `PPE`, `PRODUCTION_SUPPLY` e `OTHER` (inclusive ajuste negativo). O setor tem `defaultCostCenterId`, obrigatório para esses tipos; a retirada e o ajuste negativo de contagem (pelo celular e pela tela de Conferência) usam o do setor. O cliente não escolhe centro de custo.
- **Saldo na retirada:** a lista mostra o disponível e a confirmação devolve o saldo resultante, ambos do servidor — **exceto** enquanto houver conferência em contagem no almoxarifado do setor (a contagem é cega; o saldo fica oculto até ela terminar).
- **Edição com conferência aberta:** almoxarifado, tipo de item e prefixo não mudam enquanto houver conferência em contagem do setor (`STOCK_SECTOR_HAS_ACTIVE_SESSION`).

### 12.4 Como criar um novo setor

1. Estoque → **Setores / Collector** → **Novo setor** (permissão de gestão de almoxarifados).
2. Nome (código, slug e prefixo são sugeridos e podem ser editados).
3. Tipo de item.
4. Almoxarifado: **usar existente** ou **criar novo** (código + nome). O novo é criado na mesma transação do setor; se o setor falhar, o almoxarifado não fica.
5. Conferir "Itens que este setor irá enxergar: N" (COUNT no servidor). Zero = aviso: defina o almoxarifado como padrão dos itens em Estoque → Itens.
6. Operações (contagem / retirada) e centro de custo das saídas (obrigatório para os tipos acima).
7. Salvar → na lista, botão de QR → visualizar, imprimir, baixar imagem ou copiar link.

Setor não é apagado: use **Inativar**. Inativo some do Collector; o histórico permanece.

### 12.5 QR

- Conteúdo: `<INVENTORY_COLLECTOR_PUBLIC_BASE_URL>/collector/sector/<slug>`, montado só no servidor (`GET /api/inventory/collector/sector-qr?sector=<slug>`, permissão de gestão de conferências).
- Sem base pública válida o servidor recusa (`COLLECTOR_PUBLIC_BASE_URL_REQUIRED` / `_INVALID`) e a tela mostra erro de configuração — nenhuma URL é inventada.
- O QR é fixo por setor. Mudar o slug invalida QRs impressos. O QR de item (etiqueta) e o QR dos setores fixos não mudaram.

### 12.6 Celular

`/collector/sector/<slug>` → nome do setor e almoxarifado → **O que deseja fazer?** → `CONTAGEM` / `RETIRADA` (só as operações habilitadas).

- **Contagem:** continua a conferência compatível ou abre uma nova; lista cega com busca por código/descrição e filtro; quantidade em teclado numérico; "Contagem salva: CÓDIGO" a cada item; finalizar → divergências → aplicar.
- **Retirada:** busca no servidor (páginas de 50, "Carregar mais"); item mostra o disponível; quantidade, quem retira e destino/motivo opcional; comprovante com saldo resultante.
- **Erros:** frases próprias para saldo insuficiente, item fora do setor/inativo, almoxarifado errado, setor inativo, operação não permitida, sessão incompatível, versão conflitante, operação repetida e aparelho não autorizado. Erro inesperado nunca mostra detalhe técnico.

### 12.7 Segurança e autoridade do servidor

| Campo | Quem decide |
|---|---|
| Aparelho / ator | Peer Tailscale + Device Registry; identidade no corpo é recusada (`COLLECTOR_IDENTITY_FIELD_REJECTED`) |
| Strategy, tipo de item | Linha do setor no banco |
| Almoxarifado | Setor; `warehouseId` do cliente só é aceito se coincidir |
| Tipo de movimento | Constante `REQUISITION_EXIT` no serviço |
| Centro de custo | Setor |
| Item | Validado na transação contra o predicado do setor |
| Capacidades | Setor, a cada rota |

Cadastro: listar exige visão de estoque; criar/editar/inativar, opções e prévia exigem gestão de almoxarifados (também conferida no service). Corpo do cadastro é normalizado campo a campo (sem mass assignment); `code` é imutável.

### 12.8 Idempotência e concorrência

- Abrir sessão: `pg_advisory_xact_lock` por almoxarifado → dois toques não abrem duas conferências.
- Contar: `expectedVersion` (CAS) + `operationId` → sem lost update, replay sem segunda observação.
- Aplicar ajustes: `generatedMovementId` único por linha + sessão `ADJUSTED` → reaplicar não gera segundo movimento.
- Retirar: `operationId` único (`InventoryCollectorWithdrawal`) na mesma transação do movimento → segundo envio devolve o resultado do primeiro; saldo insuficiente é barrado pelo motor, sob o lock de saldo do motor.
- Os mecanismos são os mesmos dos fluxos legados (núcleo compartilhado), cobertos pelos DB gates existentes. Não há DB gate específico do STANDARD (ver 12.12).

### 12.9 Performance

| Operação | Consultas |
|---|---|
| Resolver setor | 0 (legado) / 1 (STANDARD) |
| Lista de setores | 2 (página + total) |
| Prévia de população | 1 `COUNT` |
| População da contagem | 3 + 1 `createMany` por 1.000 linhas |
| Abrir sessão | Constante (igual para 1 ou 500 itens — testado) |
| Lista de retirada | 3 por página de 50 (testado com 1.200 itens) |
| Retirada | Constante |

Índices usados: `InventoryItem(itemType)`, `(status)`, `(defaultWarehouseId)`, `(controlsStock)`; `InventoryBalance(warehouseId)`; `InventoryStockSector(slug)` e `(sessionCodePrefix)` únicos.

### 12.10 Migrations

| Migration | Conteúdo |
|---|---|
| `20261006180000_inventory_stock_sector` | Cria enums, tabela, índices, unique parcial (1 setor STANDARD ativo por tipo × almoxarifado), FK para almoxarifado |
| `20261006190000_inventory_stock_sector_cost_center` | Coluna `defaultCostCenterId` (nullable) + índice + FK para `CostCenter` |

Ambas aditivas; nada muda em `InventoryBalance`, `InventoryMovement`, `InventoryItem`, `InventoryWarehouse`, `Product`, `Material` ou Nomus. **Ordem:** migrations antes do código. Não aplicar em produção sem homologação.

### 12.11 Homologação

1. Aplicar as duas migrations em homologação e publicar o código.
2. Conferir `INVENTORY_COLLECTOR_PUBLIC_BASE_URL`.
3. Estoque → Setores / Collector → Novo setor: `ADMINISTRATIVO` / Estoque Administrativo / `administrativo` / `ADM` / Suprimento administrativo / almoxarifado existente `ADMINISTRATIVO` / contagem e retirada / centro de custo. A prévia deve mostrar 311.
4. Emitir o QR e abrir `/collector/sector/administrativo` no celular autorizado.
5. Contagem: contar alguns itens, finalizar com pendentes, aplicar. Conferir movimentos `POSITIVE_ADJUSTMENT` e saldos.
6. Retirada: retirar parte de um item contado; conferir saldo resultante, `REQUISITION_EXIT` com centro de custo e o registro em `InventoryCollectorWithdrawal`.
7. Regressão: abrir os QRs de Matéria-prima, Componentes e Produto acabado e iniciar uma contagem em cada.

Consultas de conferência (somente leitura):

```sql
SELECT code, slug, status, strategy, "itemType", "sessionCodePrefix",
       "allowsCounting", "allowsWithdrawal", "warehouseId", "defaultCostCenterId"
  FROM "InventoryStockSector";

SELECT count(*) FROM "InventoryItem" i
 WHERE i.status = 'ACTIVE' AND i."controlsStock" AND i."itemType" = 'ADMINISTRATIVE_SUPPLY'
   AND (i."defaultWarehouseId" = (SELECT id FROM "InventoryWarehouse" WHERE code = 'ADMINISTRATIVO')
        OR EXISTS (SELECT 1 FROM "InventoryBalance" b
                    WHERE b."itemId" = i.id
                      AND b."warehouseId" = (SELECT id FROM "InventoryWarehouse" WHERE code = 'ADMINISTRATIVO')));

SELECT code, status, "startedAt", "finishedAt" FROM "InventoryCountSession"
 WHERE code LIKE 'ADM-%' ORDER BY "createdAt" DESC LIMIT 10;

SELECT m."movementType", m.quantity, m."costCenterId", m."originType", m."createdAt"
  FROM "InventoryMovement" m JOIN "InventoryItem" i ON i.id = m."itemId"
 WHERE i."itemType" = 'ADMINISTRATIVE_SUPPLY' ORDER BY m."createdAt" DESC LIMIT 20;

SELECT w."operationId", w.sector, w.quantity, w."withdrawnBy", w."movementId", w."createdAt"
  FROM "InventoryCollectorWithdrawal" w ORDER BY w."createdAt" DESC LIMIT 20;

SELECT "entityType", action, "userName", "createdAt" FROM "InventoryAuditLog"
 WHERE "entityType" IN ('InventoryStockSector', 'InventoryWarehouse')
 ORDER BY "createdAt" DESC LIMIT 20;
```

### 12.12 Troubleshooting

| Sintoma | Causa provável |
|---|---|
| Celular: "Setor não encontrado" | Slug do QR não existe (slug alterado depois de imprimir) |
| Celular: "Setor com configuração incompleta" | Setor sem centro de custo exigido pelo tipo, ou tipo/prefixo reservado |
| Celular: "Este setor ainda não tem itens ativos" | Nenhum item do tipo com o almoxarifado como padrão ou saldo nele |
| 409 ao iniciar contagem | Outra conferência em contagem no mesmo almoxarifado; conclua ou cancele |
| Retirada sem saldo na tela | Conferência em contagem aberta no almoxarifado (saldo oculto de propósito) |
| QR: erro de configuração | `INVENTORY_COLLECTOR_PUBLIC_BASE_URL` ausente ou inválida |
| Edição recusada (`STOCK_SECTOR_HAS_ACTIVE_SESSION`) | Há conferência em contagem do setor |

### 12.13 Rollback

| Camada | Ação |
|---|---|
| Um setor | Inativar na tela: some do Collector imediatamente |
| Código | Reverter o deploy; MP/CP/PA não dependem da tabela |
| Migrations | Só se as tabelas/coluna não tiverem uso: `ALTER TABLE "InventoryStockSector" DROP COLUMN "defaultCostCenterId"` e `DROP TABLE "InventoryStockSector"` + os dois enums |
| Movimentos e saldos já gerados | Permanecem (são fatos); corrigir por estorno/ajuste pelo motor, nunca por SQL |

### 12.14 Riscos residuais

- **Concorrência real não exercitada para o STANDARD:** os testes rodam em Prisma em memória. Locks e unicidade são os mesmos dos fluxos legados (já cobertos por DB gates), mas não há DB gate próprio do STANDARD.
- **Consultas não executadas em PostgreSQL real** neste ambiente (formato igual ao dos fluxos de produto).
- **Centro de custo desativado depois:** o setor continua usando-o até ser editado.
- **Um setor por almoxarifado em contagem:** dois setores no mesmo almoxarifado não contam ao mesmo tempo (409), por desenho.

---

*Documento preparado para implementação incremental. Qualquer desvio que force MP/CP/PA a depender de `InventoryStockSector` deve ser rejeitado em review.*
