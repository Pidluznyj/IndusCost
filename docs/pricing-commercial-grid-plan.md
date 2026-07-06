# Auditoria: grid de preços comerciais publicados (Formação de Preço)

> **Projeto:** IndusCost / My Industry  
> **Tela:** Comercial → Formação de Preço (`/pricing`)  
> **Data da auditoria:** 2026-07-06  
> **Escopo:** mapeamento apenas — sem alteração de cálculo, publicação, custo oficial ou migrations.

---

## Resumo executivo

Após **Gerar Tabelas Comerciais** e **publicar** versões, o grid inferior continua vazio com *“Nenhuma premissa configurada”* porque ele lista **`ProductPricing` (premissas)**, não **`PriceTableItem` (preços publicados)**. Publicar tabela comercial **não cria** linhas em `ProductPricing`.

A evolução desejada — consulta operacional de preços vigentes — **já tem modelo e endpoints parciais**; falta expor isso na UI do grid inferior sem recalcular preço publicado.

---

## Checklist “How it works / YAGNI + reutilização”

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Isso realmente precisa existir? | **Sim.** Usuários publicam tabelas e precisam consultar SKU/preço vigente na mesma tela; hoje só veem resultado nos cards de geração ou em Propostas. |
| 2 | Já existe modelo de versão de tabela comercial publicada? | **Sim.** `PriceTableVersion` (`status = PUBLISHED`, `effectiveFrom`/`effectiveTo`). |
| 3 | Já existe modelo de itens publicados? | **Sim.** `PriceTableItem` (`salePrice`, custos congelados, snapshots JSON). |
| 4 | Já existe endpoint de preços publicados? | **Parcial.** Por versão paginada e por produto+tabela; **não** há listagem unificada multi-tabela com busca SKU para o grid. |
| 5 | Já existe modal “Resultado da Formação de Preço”? | **Sim.** Em `PricingModule.tsx`; usa motor **vivo** + premissa `ProductPricing`. |
| 6 | Já existe service de detalhe do preço? | **Sim.** `calculatePriceTableItemFromFrozenCost`, `buildPricingUnitCalculationBreakdown`, `GET .../published-price`, geração em `priceTablePublication.server.ts`. |
| 7 | O grid atual lê premissas ou publicados? | **Premissas** (`GET /api/pricing` → `productPricing`). |
| 8 | O grid recalcula preço ao vivo? | **Sim** — `GET /api/pricing` chama `getProductCostAnalysis` e recalcula `suggestedPrice` por linha. |
| 9 | Risco de alterar custo/tabela publicada? | **Alto** se o novo grid recalcular. Deve ler apenas `PriceTableItem.salePrice` e snapshots; publicação já é imutável por versão. |
| 10 | Dá para reaproveitar componentes/rotas? | **Sim** — ver seção “Reaproveitamento”. |

---

## 1. Estado atual da tela

### Rota e orquestrador

| Item | Local |
|------|--------|
| Rota | `/pricing` → `src/App.tsx` |
| Componente principal | `src/components/PricingModule.tsx` (~2.9k linhas) |
| Indicadores | `/pricing/indicators` → `src/components/contextual/PricingFormationIndicatorsDashboard.tsx` |

### Layout (de cima para baixo)

1. **Gerar Tabelas Comerciais** (card colapsável) — gera/publica DRAFTs comerciais.
2. **Gerar tabela custo de produção** — DRAFT de `ProductionCostTableVersion`.
3. **`ProductionCostTablesPanel`** — versões de custo de produção.
4. **Tabela custo de MP** — `MaterialCostTablesPanel`.
5. **`CostPriceMarginAuditPanel`** — auditoria integrada (`GET /api/cost-price-margin/audit`).
6. Toggle **Gestão Unitária** | **Processamento em Lote**.
7. **Grid inferior (UNIT)** — premissas `ProductPricing` + filtros SKU/nome.
8. **Grid BATCH** — seleção de produtos + simulação/aplicação em lote.
9. Modais: Resultado da Formação, Calculadora de Venda, Nova Premissa.

### Painéis filhos (`src/components/pricing/`)

| Arquivo | Função |
|---------|--------|
| `ProductionCostTablesPanel.tsx` | Custos de produção versionados |
| `MaterialCostTablesPanel.tsx` | Custos de MP versionados |
| `CostPriceMarginAuditPanel.tsx` | Cobertura custo/preço/margem |
| `PricingOpenBookTab.tsx` | Aba composição no modal de resultado |
| `PricingDetailedCompositionTab.tsx` | Aba composição detalhada |

### Grid inferior — comportamento atual

| Aspecto | Detalhe |
|---------|---------|
| Componente | Tabela inline em `PricingModule.tsx` (Gestão Unitária) |
| Estado | `pricings` via `fetchData()` |
| API | `GET /api/pricing` |
| Filtro/busca | Client-side: `filterAndSortPricingRows` (`src/lib/pricingListFilters.ts`) — nome, SKU, regra fiscal, faixas margem/comissão |
| Vazio | `pricings.length === 0` → **“Nenhuma premissa configurada.”** |
| Contador | “Exibindo X de Y **premissa(s)**” |
| Ações por linha | Calcular (modal), editar premissa, excluir |
| Recálculo | **Sim** — backend recalcula `suggestedPrice` com motor vivo em cada `GET /api/pricing` |

### Por que o grid fica vazio após publicar

```
Publicar tabela comercial
  → PriceTableVersion (PUBLISHED)
  → PriceTableItem[] (salePrice congelado)

Grid inferior
  → GET /api/pricing
  → ProductPricing.findMany()
  → (opcional) getProductCostAnalysis + markup divisor

Não há JOIN nem sincronização entre PriceTableItem e ProductPricing.
```

Publicação atualiza apenas `priceTables` no card superior (`GET /api/price-tables` após publish). **`fetchData()` / `pricings` não é recarregado** — mas mesmo que fosse, `ProductPricing` continuaria vazio se o usuário nunca cadastrou premissas manualmente.

---

## 2. Modelos / tabelas existentes

### Premissas e simulação (motor vivo)

| Modelo | Papel |
|--------|--------|
| `ProductPricing` | Premissa por `(productId, taxRuleId)`: margem, comissão, frete, outros |
| `Simulation` | Simulação salva (fora do fluxo oficial de tabela) |
| `TaxRule` / `TaxComponent` | Regras fiscais |
| `Product` | Catálogo PRODUCT / COMPONENT |

### Tabela comercial publicada (oficial)

| Modelo | Papel |
|--------|--------|
| `PriceTable` | Catálogo (`code`, `name`, `defaultMarginPct`, `status`) — seed em `scripts/seedPriceTables.ts` |
| `PriceTableVersion` | Versão DRAFT/PUBLISHED, vigência, `taxRuleId`, `productionCostTableVersionId`, `generationSummaryJson` |
| `PriceTableItem` | Linha publicada: `salePrice`, custos congelados (`frozenTotalCost`, MP/HH/HM/tax/other), `marginPct`, `commissionPerc`, `costSnapshotJson`, `formulaSnapshotJson` |

### Custo de produção (entrada da geração comercial)

| Modelo | Papel |
|--------|--------|
| `ProductionCostTableVersion` | Custo industrial publicado |
| `ProductionCostTableItem` | `unitProductionCost` por produto |
| `MaterialCostTableVersion` / `MaterialCostTableItem` | MP publicada (upstream) |

### Referência arquitetural

Ver `docs/architecture/versioned-cost-price-margin.md` — preço oficial = `PriceTableItem.salePrice`; margem **não** usa motor vivo.

---

## 3. Endpoints existentes

### Grid inferior e premissas

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/pricing` | Lista premissas + `suggestedPrice` recalculado (motor vivo) |
| POST | `/api/pricing` | Cria/atualiza premissa |
| DELETE | `/api/pricing/:id` | Remove premissa |
| POST | `/api/pricing/bulk-delete` | Exclusão em lote |
| GET | `/api/pricing/:productId/:taxRuleId/calculate` | Modal **Resultado da Formação de Preço** |
| POST | `/api/pricing/simulate-unit` | Calculadora (sem salvar) |
| POST | `/api/pricing/simulate-batch` | Lote simulado |
| POST | `/api/pricing/apply-batch` | Persiste premissas em lote |

### Tabelas comerciais

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/price-tables` | Lista tabelas + `latestPublishedVersion` / `latestDraftVersion` |
| POST | `/api/price-tables/:priceTableId/versions/generate-draft` | **Gerar DRAFTs comerciais** |
| POST | `/api/price-table-versions/:id/publish` | Publicar DRAFT |
| GET | `/api/price-table-versions/:id/items` | Itens paginados de uma versão (`page`, `limit`, max 200) |
| GET | `/api/price-tables/:priceTableId/products/:productId/published-price` | Preço vigente de um SKU em uma tabela (Propostas) |
| GET | `/api/price-tables/production-cost-source` | Valida MP/custo produção antes de gerar comercial |

### Auxiliares da tela

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/products` | Busca SKU/nome (client-side) |
| GET | `/api/tax-rules` | Regras fiscais |
| GET | `/api/products/:id/pricing-snapshot` | Custo para calculadora |
| GET | `/api/cost-price-margin/audit` | Painel auditoria |

### Lacuna para o novo grid

Não existe hoje:

- `GET` agregado “preços publicados vigentes” com filtro SKU multi-tabela.
- Endpoint que retorne, por produto, colunas dinâmicas por `PriceTable.code` (nomes vindos do cadastro, não hardcoded).

**Candidato mínimo:** estender ou compor `GET /api/price-table-versions/:id/items` + seleção de `latestPublishedVersion` de `GET /api/price-tables`, ou novo endpoint read-only em `src/lib/` dedicado.

---

## 4. Fluxo atual de publicação

```
1. Usuário: Gerar Tabelas Comerciais (PricingModule)
   - Seleciona tabelas (UI filtra códigos conhecidos; catálogo real em PriceTable)
   - Regra fiscal + vigência + comissão por tabela
   - POST .../generate-draft (por tabela)

2. Backend: generatePriceTableVersionDraftFromProductionCosts
   (src/lib/priceTablePublication.server.ts)
   - resolve ProductionCostTableVersion PUBLISHED na data
   - para cada produto elegível:
     - custo = ProductionCostTableItem.unitProductionCost (congelado)
     - premissa opcional ProductPricing (comissão/frete/outros; warning se ausente)
     - calculatePriceTableItemFromFrozenCost → salePrice
     - INSERT PriceTableItem + snapshots

3. Usuário: Publicar DRAFT no card de resultado
   - POST /api/price-table-versions/:id/publish
   - Arquiva versão PUBLISHED anterior da mesma tabela
   - Atualiza latestPublishedVersion (UI recarrega GET /api/price-tables)

4. Consumo downstream
   - Propostas: GET .../published-price
   - Margem pedidos: loadOfficialPriceTableItemsForPairs (salesOrderMarginService)
   - Comissões: faixas ATACADO/VAREJO por salePrice publicado
```

**Importante:** geração usa `ProductPricing` apenas como **entrada opcional** na DRAFT; publicação **não** espelha resultado em `ProductPricing`.

---

## 5. Fonte correta para o novo grid de preços publicados

| Campo UI desejado | Fonte oficial |
|------------------|---------------|
| SKU / produto | `PriceTableItem.sku`, `productName` (+ `Product` join) |
| Preço vigente | `PriceTableItem.salePrice` |
| Tabela comercial | `PriceTable.code` / `PriceTable.name` (cadastro) |
| Versão | `PriceTableVersion.versionNumber`, `publishedAt`, `effectiveFrom` |
| Custo congelado | `PriceTableItem.frozenTotalCost` (somente leitura) |
| Margem / comissão aplicada na publicação | `marginPct`, `commissionPerc` |
| Detalhe / memória | `formulaSnapshotJson`, `costSnapshotJson` |

**Versão vigente:** `resolvePublishedPriceTableVersionForDate` (`src/lib/priceTablePublication.server.ts`) — mesma regra de Propostas e margem.

**Não usar:**

- `GET /api/pricing` para preço publicado.
- `getProductCostAnalysis` no grid de consulta publicada.
- `ProductPricing.suggestedPrice` como preço comercial oficial.

---

## 6. Riscos de recalcular preço publicado

| Risco | Mitigação |
|-------|-----------|
| Alterar percepção de preço oficial | Exibir apenas `salePrice` persistido |
| Divergir de Propostas / margem | Reusar `resolvePublishedPriceTableVersionForDate` e mesmos joins |
| Confundir premissa com publicado | Separar abas ou seções: “Premissas” vs “Preços publicados” |
| Performance (motor vivo no list) | Paginação server-side (já existe em `.../items`) |
| Edição acidental | Grid read-only; alteração só via nova DRAFT + publish |

Arquitetura documentada: *“Margem e preço comercial não chamam o motor vivo — leem snapshots publicados.”*

---

## 5.1 Seleção das até 4 tabelas no grid

Quando existem mais de 4 tabelas comerciais ACTIVE com versão vigente, `resolveCommercialPublishedTableContexts` aplica:

1. **Prioridade oficial** — códigos `ATACADO`, `VAREJO_1`, `VAREJO_2`, `VAREJO_3` (nessa ordem).
2. **Demais tabelas** — ordenadas por `publishedAt` mais recente; empate por `code` (locale `pt-BR`).
3. **Limite** — no máximo `MAX_COMMERCIAL_PUBLISHED_TABLES` (4) colunas no grid.
4. **Principal** — `ATACADO` recebe `isPrimary: true` no payload (usado no modal de detalhe).

Versões **DRAFT** nunca entram: o resolver só considera versões vigentes retornadas por `resolvePublishedPriceTableVersionForDate` (`PUBLISHED` / `ARCHIVED` com janela de vigência válida).

---

## 5.2 Publicação → grid

Fluxo após `POST /api/price-table-versions/:id/publish`:

1. Versão DRAFT → `PUBLISHED`; versão anterior da mesma tabela → `ARCHIVED`.
2. Itens já criados na DRAFT permanecem em `PriceTableItem` (congelados).
3. `GET /api/pricing/commercial-published-prices` lê esses itens na versão vigente.
4. Frontend (`PricingModule`): mensagem *“Tabela publicada. Preços disponíveis no grid.”*, `setPublishedGridPage(1)` e `reloadPublishedPrices()` com cache-bust (`_r=timestamp`).

Não há republicação automática nem recálculo do grid.

---

## 5.3 Fonte oficial do grid (implementado)

| Camada | Artefato |
|--------|----------|
| Endpoint | `GET /api/pricing/commercial-published-prices` |
| Service | `buildCommercialPublishedPriceGridSnapshot` (`src/lib/pricing/commercialPublishedPrices.server.ts`) |
| Versão vigente | `resolvePublishedPriceTableVersionForDate` |
| Preço exibido | `PriceTableItem.salePrice` (congelado) via `readPublishedPriceItemMetrics` |
| Recálculo | **Proibido** no grid — não chama `getProductCostAnalysis` nem motor de formação |

O grid da tela (`CommercialPublishedPricesGrid` + `useCommercialPublishedPrices`) consome o mesmo endpoint. Premissas `ProductPricing` ficam em painel secundário.

### Regra: preço publicado sem recálculo

- Publicar grava `PriceTableItem` com `salePrice`, custos e snapshots JSON.
- O grid **lê** esses valores; qualquer divergência indica bug de mapeamento, não nova simulação.
- Simulação ao vivo permanece isolada no modal via `/api/pricing/:productId/:taxRuleId/calculate`.

---

## 5.4 Como auditar o grid

Script read-only: `scripts/audit-commercial-price-grid.ts`  
Service: `buildCommercialPublishedPriceGridAudit` (`src/lib/pricing/commercialPublishedPriceGridAudit.server.ts`)

**Comandos:**

```bash
npm run audit:commercial-price-grid
npm run audit:commercial-price-grid -- --sku=309.01AA
npm run audit:commercial-price-grid -- --search=alpha
npm run audit:commercial-price-grid -- --product-id=<uuid>
npm run audit:commercial-price-grid -- --json
npm run audit:commercial-price-grid -- --csv
```

**O que valida:**

1. Tabelas comerciais vigentes e versões usadas.
2. Quantidade de produtos no grid e com preço por tabela.
3. Produtos sem preço em alguma coluna (`PARTIAL` / `NO_PRICE`).
4. Divergências célula do grid vs `PriceTableItem` (`salePrice`, `priceItemId`, `versionId`).
5. Top produtos por maior `salePrice` publicado.
6. Status final **PASS** (sem divergências) ou **FAIL**.

**Export CSV** (`--csv`): grava em `tmp/commercial-published-price-grid-<timestamp>.csv` com colunas SKU, Produto, Info tributária, Tabela 1–4 preço, Última publicação, Status — mesma fonte do grid (`buildCommercialPublishedPriceGridCsv`).

**Auditar um SKU:** `--sku=CODIGO` filtra o produto e compara cada célula publicada com o item congelado no banco. Exit code `1` em FAIL.

---

## 7. Plano incremental de implementação

### Fase A — Consulta read-only (YAGNI)

1. Adicionar seção **“Preços comerciais publicados”** abaixo do card de geração (ou sub-aba no toggle UNIT).
2. Seletor de **tabela** populado por `GET /api/price-tables` → `latestPublishedVersion` (nome/`code` do cadastro).
3. Grid alimentado por `GET /api/price-table-versions/:id/items` com paginação + busca SKU (query param novo ou filtro client-side na página atual).
4. Colunas: SKU, produto, `salePrice`, margem%, comissão%, versão, vigência.
5. Empty state distinto: *“Nenhuma versão publicada para esta tabela”* vs *“Nenhuma premissa configurada”*.

### Fase B — Busca operacional multi-tabela (opcional)

1. Endpoint read-only: busca por SKU em todas as tabelas ACTIVE com versão PUBLISHED vigente.
2. Linha pivô: produto × colunas dinâmicas por `PriceTable.name`.
3. Reutilizar normalização de busca de `pricingListFilters.ts`.

### Fase C — Detalhe sem recálculo

1. Modal de detalhe lendo `formulaSnapshotJson` / `costSnapshotJson` do item publicado.
2. **Não** reutilizar modal “Resultado da Formação” para publicados (ele usa motor vivo + premissa).

### Fase D — UX / premissas coexistindo

1. Manter grid de premissas para quem configura `ProductPricing` antes de gerar DRAFT.
2. Ajustar copy: “premissa” vs “preço publicado”.
3. Indicadores (`/pricing/indicators`) hoje só contam premissas — avaliar KPI separado depois.

### Fora de escopo imediato

- Migration / novo modelo.
- Alterar `generatePriceTableVersionDraftFromProductionCosts`.
- Sincronizar auto `ProductPricing` ao publicar.
- Remover premissas.

---

## 8. Reaproveitamento

| Peça existente | Reuso |
|----------------|-------|
| `GET /api/price-tables` | Seletor de tabela + metadados `latestPublishedVersion` |
| `GET /api/price-table-versions/:id/items` | Corpo do grid paginado |
| `GET .../published-price` | Detalhe unitário (padrão Propostas) |
| `resolvePublishedPriceTableVersionForDate` | Resolver vigência |
| `filterAndSortPricingRows` / `normalizeSearchString` | Padrão de busca SKU |
| `SearchableSelect` | Filtro produto/tabela |
| `ProposalModule` (`fetchPublishedPrice`) | Referência de integração |
| `priceTablePublication.server.test.ts` | Garantias de imutabilidade pós-publish |
| Cards `commercialGenResults` | Já mostram resumo pós-geração — link “ver itens publicados” |

---

## 9. Código legado / candidatos a inativação futura

| Item | Observação |
|------|------------|
| `GET /api/pricing` com `getProductCostAnalysis` por linha | Adequado para **premissas**, inadequado como fonte de preço oficial; manter separado |
| `COMMERCIAL_TABLE_CODES` em `PricingModule.tsx` | UI pré-seleciona ATACADO/VAREJO_1–3; catálogo real está em `PriceTable` — novo grid deve usar `priceTables[].name/code` |
| `getDefaultCommissionForCode` hardcoded | Política de comissão na geração; não misturar com grid de consulta |
| Contador “premissa(s)” no grid | Misleading após fluxo só de publicação — copy a revisar |
| `PricingFormationIndicatorsDashboard` | Só `ProductPricing` — não reflete cobertura de `PriceTableItem` |
| Expectativa de que publicar preencha grid inferior | **Bug de produto/UX**, não de publicação |

---

## 10. Componentes analisados (índice)

- `src/components/PricingModule.tsx`
- `src/components/pricing/*.tsx`
- `src/components/contextual/PricingFormationIndicatorsDashboard.tsx`
- `src/components/ProposalModule.tsx` (consumo `published-price`)
- `src/lib/priceTablePublication.server.ts`
- `src/lib/priceTablePublication.ts`
- `src/lib/pricingListFilters.ts`
- `src/lib/pricingUnitCalculationBreakdown.ts`
- `server.ts` (rotas `/api/pricing`, `/api/price-tables*`)
- `prisma/schema.prisma` (`ProductPricing`, `PriceTable*`)
- `docs/architecture/versioned-cost-price-margin.md`

---

## Referências

- Seed tabelas: `scripts/seedPriceTables.ts`
- Testes publicação: `src/lib/priceTablePublication.server.test.ts`
- Baseline arquitetura: `src/lib/versionedCostArchitectureBaseline.test.ts`
