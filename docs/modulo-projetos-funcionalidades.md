# Módulo Projetos — Funcionalidades e Arquitetura

Documentação baseada no código real do IndusCost (auditoria em `src/lib/projectsModuleAudit.ts`).

## 1. Visão geral

O módulo **Projetos** permite simulações técnicas e comerciais de novos produtos, componentes, moldes, alterações de engenharia e estudos de custo **sem alterar o cadastro oficial** de produtos, materiais ou BOM do Nomus.

**Rota principal:** `/projects`  
**Componente raiz:** `src/components/ProjectsModule.tsx`  
**Registro de rotas API:** `registerProjectsRoutes` em `src/lib/projectsRoutes.ts` (chamado em `server.ts`)

### Objetivo de negócio

- Orçar e estudar custo de desenvolvimentos antes de cadastrar no ERP.
- Importar snapshot de produto oficial como ponto de partida editável.
- Montar BOM simulada, processos/HH, moldes e outros custos.
- Calcular custo unitário, amortizações, margem e preço sugerido.
- Manter histórico por versão de projeto.

---

## 2. Arquivos do módulo (por categoria)

### 2.1 Banco / Prisma

| Arquivo | Conteúdo |
|---------|----------|
| `prisma/schema.prisma` | Modelos `Project*`, enums de tipo/status/linha |

### 2.2 Backend / services

| Arquivo | Função |
|---------|--------|
| `src/lib/projectsService.ts` | CRUD, serialização, `recalculateAndPersistVersionCosts` |
| `src/lib/projectsCalculations.ts` | Fórmulas de custo, margem, markup |
| `src/lib/projectsEngineeringCostRollup.ts` | Rollup hierárquico de custo na árvore |
| `src/lib/projectsProductSnapshot.ts` | Snapshot plano de produto oficial (preview) |
| `src/lib/projectsProductEngineeringSnapshot.ts` | Árvore de engenharia oficial → `ProjectStructureLine` |
| `src/lib/projectsStructureLineBuilder.ts` | Criação/validação de linhas de estrutura |
| `src/lib/projectsMoldCostLines.ts` | Linhas de amortização de molde |
| `src/lib/projectsOtherCostGroups.ts` | Grupos de outros custos via `ProjectSimulatedItem` |
| `src/lib/projectsCostAmortization.ts` | Regras de amortização entre alvos |
| `src/lib/projectsCostAmortizationService.ts` | Persistência de amortizações |
| `src/lib/projectsPricing.ts` / `projectsPricingService.ts` | Precificação por item |
| `src/lib/projectsDashboard.ts` | KPIs da listagem |
| `src/lib/projectsGuidedFlow.ts` | Fluxo guiado de criação de itens |
| `src/lib/projectsSimulationItemService.ts` | Referências ao módulo Simulações |
| `src/lib/projectSimulationMode.ts` | Isolamento do cadastro oficial |
| `src/lib/projectsPermissions.ts` | Permissões e guards |
| `src/lib/projectsExecutiveReport.ts` | Dados do relatório executivo |

### 2.3 Endpoints / rotas

| Arquivo | Função |
|---------|--------|
| `src/lib/projectsRoutes.ts` | ~35 endpoints REST |
| `server.ts` | Registra `registerProjectsRoutes` |

### 2.4 Frontend / telas

| Arquivo | Função |
|---------|--------|
| `src/components/ProjectsModule.tsx` | Listagem, detalhe, abas, modais |
| `src/components/projects/*.tsx` | 39 componentes (workspace, modais, árvore, custos) |

### 2.5 Tipos / helpers

| Arquivo | Função |
|---------|--------|
| `src/types/projects.ts` | Tipos compartilhados frontend/backend |
| `src/lib/projectsNavigation.ts` | Abas e rotas do projeto |
| `src/lib/projectsUiUtils.ts` | Labels e formatação de HH/processos |
| `src/lib/projectsModuleAudit.ts` | Auditoria tipada de funcionalidades |

### 2.6 Testes

34 arquivos `src/lib/projects*.test.ts` — ver seção 10.

---

## 3. Entidades do banco

### `Project`

Cabeçalho do projeto comercial/técnico.

| Campo | Negócio |
|-------|---------|
| `number`, `code` | Identificação (`PRJ-00001`) |
| `title`, `description` | Nome e contexto |
| `customerName`, `customerDocument` | Cliente (texto ou via lookup) |
| `commercialOwner`, `technicalOwner` | Responsáveis |
| `projectType` | `NEW_PRODUCT`, `MOLD`, `QUICK_ESTIMATE`, etc. |
| `status` | Workflow (`DRAFT` … `CONVERTED`) |
| `expectedMonthlyVolume`, `targetPrice`, `targetMarginPercent` | Metas comerciais |

**Relacionamentos:** versões, produtos simulados, itens simulados, linhas de estrutura, moldes, amortizações, pricing.

### `ProjectVersion`

Snapshot versionado do conteúdo e totais de custo.

| Campo | Negócio |
|-------|---------|
| `versionNumber`, `isCurrent` | Controle de versão |
| `totalEstimatedCost`, `unitCost`, `suggestedPrice` | Totais calculados |
| `assumptionsJson` | Premissas da versão |

Toda simulação (BOM, itens, moldes) é amarrada a uma `versionId`.

### `ProjectSimulatedProduct`

Produto simulado do projeto (equivalente a um SKU de estudo).

Campos: `provisionalCode`, `description`, `unit`, `estimatedWeight`, `expectedVolume`, `batchSize`.

Usado como raiz da árvore de engenharia no workspace (`ProjectSimulatedProductWorkspace.tsx`).

### `ProjectSimulatedItem`

Componentes, materiais, embalagens, serviços e outros custos **como entidades do projeto**.

| `itemType` | Uso |
|------------|-----|
| `RAW_MATERIAL`, `COMPONENT`, `PACKAGING` | Insumos |
| `SERVICE`, `OUTSOURCED_PROCESS` | Terceiros |
| `MOLD`, `TOOLING`, `OTHER` | Custos adicionais |

**Nota:** não existe model `ProjectOtherCost` — outros custos usam `ProjectSimulatedItem` com metadados em `notes` (`projectsOtherCostGroups.ts`).

### `ProjectStructureLine`

Núcleo da BOM simulada e dos processos/HH.

| Campo | Negócio |
|-------|---------|
| `lineType` | `RAW_MATERIAL`, `COMPONENT`, `PROCESS`, `MOLD_AMORTIZATION`, etc. |
| `sourceType` | `EXISTING_PRODUCT`, `EXISTING_MATERIAL`, `SIMULATED_ITEM`, `MANUAL` |
| `parentLineId`, `level`, `treePath` | Hierarquia |
| `existingProductId` / `existingMaterialId` | Referência oficial (somente leitura) |
| `simulatedItemId` | Referência a item do projeto |
| `quantity`, `lossPercent`, `unitCostSnapshot`, `totalCost` | Custo da linha |
| `countsInSimulatedProductCost` | Evita dupla contagem na árvore |
| `snapshotRootProductId` | Agrupa linhas importadas de um produto oficial |

**HH/processos:** `lineType = PROCESS`, `sourceType = MANUAL`, `unitSnapshot = HH` (não há `ProjectLaborLine`).

### `ProjectMold`

Molde com modos de cobrança (`CHARGED_SEPARATELY`, `AMORTIZED_IN_PRODUCT`, etc.), cavidades, custo de construção e amortização por quantidade.

### `ProjectCostAmortization` / `ProjectCostAmortizationAllocation`

Distribui custo de molde ou outro custo entre alvos (`SIMULATION`, `OFFICIAL_PRODUCT`, etc.) com percentuais e status (`DISTRIBUTED`, `INCOMPLETE`, …).

### `ProjectPricingConfig` / `ProjectPricingItem`

Configuração fiscal/margem e preço sugerido por item-alvo, com snapshots de custo e status (`NO_COST`, `PENDING`, `CALCULATED`).

---

## 4. Endpoints API

Permissões base:

| Guard | Permissões |
|-------|------------|
| `view` | `projects.view` |
| `lookup` | `projects.view` ou `projects.manage` |
| `manage` | `projects.manage` |
| `DELETE /api/projects/:id` | `SUPER_ADMIN` apenas |

### Consulta e CRUD de projeto

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/projects/dashboard` | KPIs da carteira |
| GET | `/api/projects` | Listagem paginada |
| GET | `/api/projects/:id` | Detalhe completo + custos recalculados |
| POST | `/api/projects` | Criar projeto + versão 1 |
| PATCH | `/api/projects/:id` | Editar cabeçalho |
| DELETE | `/api/projects/:id` | Excluir (SUPER_ADMIN) |
| POST | `/api/projects/:id/versions` | Nova versão (cópia da corrente) |
| GET | `/api/projects/:id/versions/:versionId` | Versão específica |

### Lookups (somente leitura do oficial)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/projects/lookup/customers` | Autocomplete cliente |
| GET | `/api/projects/lookup/commercial-owners` | Responsável comercial |
| GET | `/api/projects/lookup/products` | Busca produto oficial |
| GET | `/api/projects/lookup/products/:productId/snapshot` | Preview BOM/roteiro |
| GET | `/api/projects/lookup/products/:productId/engineering-snapshot` | Árvore de engenharia |
| GET | `/api/projects/lookup/materials` | Materiais oficiais |
| GET | `/api/projects/lookup/simulations` | Simulações externas |

### Simulação no projeto

| Método | Rota | Função |
|--------|------|--------|
| POST | `/api/projects/:id/import-product-snapshot` | Importa árvore oficial → linhas |
| POST | `/api/projects/:id/simulation-references` | Vincula simulação externa |
| POST/PATCH/DELETE | `/api/projects/:id/simulated-products/...` | CRUD produto simulado |
| POST/PATCH/DELETE | `/api/projects/:id/simulated-items/...` | CRUD item simulado |
| POST/PATCH/DELETE | `/api/projects/:id/structure-lines/...` | CRUD linha BOM/HH |
| DELETE | `/api/projects/:id/structure-snapshot/:snapshotRootProductId` | Remove snapshot importado |
| POST/PATCH/DELETE | `/api/projects/:id/molds/...` | CRUD molde |
| GET/PUT/DELETE | `/api/projects/:id/cost-amortizations/...` | Amortizações |
| GET/PUT | `/api/projects/:id/pricing` | Precificação |

**Política:** `PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION` bloqueia criação direta de produto simulado via API em alguns fluxos — preferência por referência via módulo Simulações (`projectsAddItemPolicy.ts`).

---

## 5. Telas e componentes

### Listagem (`/projects`)

- Cards do dashboard (`buildProjectsDashboard`).
- Tabela com código, cliente, tipo, status, valor estimado.
- Busca, paginação, botão **Novo projeto**.
- Permissão `projects.manage` para criar/editar.

### Detalhe do projeto (`/projects/:id`)

Abas guiadas (`PROJECT_TABS` em `projectsNavigation.ts`):

| Aba | Rota | Componentes principais |
|-----|------|------------------------|
| Início | `/projects/:id` | `ProjectHomeAssistant`, callout Simulações |
| Itens do Projeto | `.../items` | `ProjectItemsTab`, modais de item/molde/engenharia |
| Custos do Projeto | `.../costs` | `ProjectGuidedCostsTab`, `ProjectCostSimulation`, `ProjectPricingSection` |
| Documentos | `.../documents` | `ProjectDocuments` |
| Histórico | `.../history` | `ProjectHistory`, `ProjectTimeline` |

### Workspace de produto simulado

`ProjectSimulatedProductWorkspace.tsx` — abas internas:

- Produto base
- Composição / árvore (`ProjectEngineeringTreePanel`)
- Processos/HH (`ProjectLaborLineModal`)
- Custo simulado (`ProjectCostSimulation`)

### Modais relevantes

| Modal | Função |
|-------|--------|
| `ProjectSimulatedProductFormModal` | Criar/editar produto simulado |
| `ProjectSimulatedItemFormModal` | Criar/editar item/componente |
| `ProjectStructureLineModal` | Adicionar linha BOM |
| `ProjectLaborLineModal` | Lançar HH |
| `ProjectMoldFormModal` / `ProjectGuidedMoldModal` | Molde |
| `ProjectOtherCostsModal` | Lote de outros custos |
| `ProjectCostAmortizationModal` | Configurar amortização |
| `ProjectAddItemModal` | Fluxo guiado de adição |

### Relatório executivo

- Rota: `/projects/:id/report`
- `ProjectExecutiveReportPage.tsx` — impressão via CSS (`ProjectExecutiveReportPrintControls`).

### Banner de isolamento

`ProjectSimulationBanner.tsx` exibe aviso de que edições não afetam cadastro oficial.

---

## 6. Fluxos de negócio

### Fluxo 1 — Criar projeto do zero

1. Usuário com `projects.manage` clica **Novo projeto**.
2. Preenche título, tipo, cliente (lookup ou texto em `ProjectCustomerLookupField`), responsável comercial (`ProjectCommercialOwnerLookupField`).
3. `POST /api/projects` → `createProjectWithVersion` cria `Project` + `ProjectVersion` v1 (`isCurrent: true`), status `DRAFT`.
4. Redireciona para detalhe; aba **Início** orienta próximos passos.

### Fluxo 2 — Importar produto oficial

1. Na aba Itens, usuário busca produto via `GET /api/projects/lookup/products`.
2. Preview: `GET .../snapshot` (BOM plana + roteiro).
3. Importação: `POST /api/projects/:id/import-product-snapshot` chama `importProductEngineeringSnapshotToProject`.
4. Sistema lê `Product`, BOM e routing oficiais; grava **cópias** em `ProjectStructureLine` com snapshots de custo/descrição.
5. Produto oficial **não é alterado** — apenas referenciado por ID nos campos `existingProductId` / snapshots.
6. Usuário edita linhas simuladas à vontade; flag `isChangedFromOfficial` marca divergências.

### Fluxo 3 — Criar produto simulado novo

1. Via módulo Simulações ou workspace (conforme política vigente).
2. `POST .../simulated-products` cria `ProjectSimulatedProduct`.
3. Adiciona linhas de estrutura, HH e moldes no workspace.
4. `GET /api/projects/:id` dispara `recalculateAndPersistVersionCosts`.

### Fluxo 4 — Criar componente do projeto

1. `POST .../simulated-items` com `itemType: COMPONENT`.
2. Em outro produto simulado, linha BOM com `sourceType: SIMULATED_ITEM` e `simulatedItemId` apontando para o componente.
3. `projectsEngineeringCostRollup.ts` propaga custo na hierarquia.

### Fluxo 5 — Montar BOM simulada

Tipos de linha (`ProjectStructureLineType`):

- Material oficial → `EXISTING_MATERIAL` + `RAW_MATERIAL`
- Produto oficial filho → `EXISTING_PRODUCT` + `COMPONENT`
- Item do projeto → `SIMULATED_ITEM`
- Manual → `MANUAL`

Custo linha: `quantity × unitCost × (1 + loss%/100)` (`calculateStructureLineTotalCost`).

### Fluxo 6 — Processos / HH

- Linha `PROCESS` com horas em `quantity`, taxa em `unitCostSnapshot`.
- Importação de roteiro oficial gera linhas PROCESS com snapshots de `hourlyRate` e horas.

### Fluxo 7 — Moldes e outros custos

- **Molde:** `ProjectMold` + eventual linha `MOLD_AMORTIZATION` na estrutura.
- **Outros custos:** `ProjectSimulatedItem` agrupados por batch em `notes` (`buildOtherCostNotes`).

### Fluxo 8 — Custo simulado e orçamento

1. `buildCostBreakdown` agrega MP, componentes, serviços/HH, embalagem, molde amortizado.
2. `recalculateAndPersistVersionCosts` persiste totais na `ProjectVersion`.
3. Amortizações avançadas via `ProjectCostAmortization`.
4. Precificação: `projectsPricing.ts` calcula preço sugerido com margem e regra fiscal opcional.
5. **Lacuna:** não há export PDF de orçamento server-side nem conversão automática para Proposta comercial.

---

## 7. Isolamento do produto oficial

| O que é oficial | O que é simulado |
|-----------------|------------------|
| `Product`, `Material`, BOM, Routing Nomus | Tabelas `Project*` |
| Consultado via lookup/snapshot | Gravado em `ProjectStructureLine`, etc. |
| Nunca PATCH via módulo Projetos | Sempre editável no projeto |

**Proteções em código:**

- `projectSimulationMode.ts`: `BLOCKED_OFFICIAL_WRITE_PATTERNS`, `isOfficialProductWriteFetch`.
- `isOfficialConversionEnabled()` retorna `false` — conversão para cadastro oficial desabilitada.
- Endpoints de projeto gravam apenas em tabelas `Project*`.
- Teste: `projectsSimulationIsolation.test.ts`.

---

## 8. Cálculos

Arquivo canônico: `src/lib/projectsCalculations.ts`.

| Cálculo | Fórmula |
|---------|---------|
| Custo linha | `q × unitCost × (1 + loss/100)` |
| Molde amortizado/un | `constructionCost / amortizationQuantity` |
| Custo unitário | MP + componentes + serviços + embalagem + molde amortizado |
| Preço sugerido | `unitCost / (1 - margin/100)` |
| Margem % | `((price - cost) / price) × 100` |
| Markup % | `(price/cost - 1) × 100` |

Rollup hierárquico: `projectsEngineeringCostRollup.ts`.  
Custo oficial na importação: `projectsOfficialBomCost.ts` + `getProjectsProductCostResolver`.

**Não implementado:** ciclo/cavidades automáticos no custo industrial unitário; impostos completos sem `TaxRule` configurada.

---

## 9. Permissões

| Permissão | Uso atual |
|-----------|-----------|
| `projects.view` | Listar, ver detalhe, amortizações, pricing |
| `projects.manage` | Criar, editar, linhas, moldes, importar snapshot |
| `projects.approve` | Definida no catálogo; **não aplicada nas rotas** |
| `projects.convert` | Definida; conversão **desabilitada** |
| SUPER_ADMIN | Único perfil que pode `DELETE` projeto |

Frontend: `canViewProjects`, `canManageProjects`, `canDeleteProject` em `ProjectsModule.tsx`.

---

## 10. Testes existentes

| Arquivo | Cobertura |
|---------|-----------|
| `projectsCrud.test.ts` | CRUD básico |
| `projectsService.test.ts` | Serviço principal |
| `projectsCalculations.test.ts` | Fórmulas de custo |
| `projectsSimulationIsolation.test.ts` | Isolamento oficial |
| `projectsProductSnapshot.test.ts` | Snapshot de produto |
| `projectsProductEngineeringSnapshot.test.ts` | Importação árvore |
| `projectsEngineeringCostRollup.test.ts` | Rollup hierárquico |
| `projectsStructureLineBuilder.test.ts` | Validação de linhas |
| `projectsCostAmortization.test.ts` | Amortizações |
| `projectsPricing.test.ts` | Precificação |
| `projectsPermissions.test.ts` | Permissões |
| `projectsGuidedFlow.test.ts` | Fluxo guiado |
| `projectsExecutiveReport.test.ts` | Relatório |
| `projectsModuleAudit.test.ts` | Estrutura da auditoria |
| + ~20 outros | Lookup, navegação, UI, moldes, refs |

**Lacunas de teste:** E2E de UI completa; workflow de aprovação; conversão oficial (desabilitada).

---

## 11. Lacunas e melhorias

### Alta prioridade

- `projects.approve` não usado no workflow de status.
- Conversão para cadastro oficial inexistente (`isOfficialConversionEnabled: false`).
- Sem PDF server-side de orçamento.
- Exclusão só SUPER_ADMIN (sem permissão granular).
- Outros custos sem model dedicado (parsing via `notes`).

### Média prioridade

- Duplicar projeto.
- Diff visual oficial vs simulado.
- Anexos persistentes e audit trail por versão.
- Onboarding Simulações vs Projeto.
- Filtros avançados na listagem.

### Baixa prioridade

- Versionamento avançado / multi-cenário.
- Templates de projeto.
- Gráficos de portfólio.
- Comparador de cenários lado a lado.

---

## 12. Roadmap sugerido

### Etapa 1 — Estabilizar base

- Aplicar `projects.approve` em transições de status.
- Totalizadores por produto simulado na aba Custos.
- Validações de quantidade/unidade na BOM.
- **Arquivos:** `projectsRoutes.ts`, `ProjectsModule.tsx`, `projectsStructureLineBuilder.ts`

### Etapa 2 — Cálculo e orçamento

- Export PDF do relatório executivo.
- Integrar pricing → módulo Comercial/Propostas.
- Assistente de amortização em lote.
- **Arquivos:** `projectsExecutiveReport.ts`, `projectsPricingService.ts`

### Etapa 3 — Aprovações e versionamento

- Workflow de status com permissões.
- Histórico de alterações por versão.
- Duplicar projeto/cenário.

### Etapa 4 — Integração comercial/financeiro

- Gerar proposta a partir do projeto.
- Sincronizar meta de margem com política comercial.

### Etapa 5 — Relatórios

- PDF server-side.
- Dashboard de portfólio de projetos.

### Etapa 6 — Gestão avançada

- Multi-cenário por cliente.
- Templates por `ProjectType`.

---

## 13. Glossário

| Termo | Significado |
|-------|-------------|
| **Snapshot** | Cópia pontual de dados oficiais gravada em `ProjectStructureLine` |
| **Produto simulado** | SKU de estudo do projeto (`ProjectSimulatedProduct`) |
| **Item simulado** | Componente/material/serviço do projeto (`ProjectSimulatedItem`) |
| **Linha de estrutura** | Entrada da BOM ou processo (`ProjectStructureLine`) |
| **Versão** | Snapshot versionado do conteúdo e totais (`ProjectVersion`) |
| **HH** | Hora-homem modelada como linha `PROCESS` |
| **Amortização** | Distribuição de custo fixo (molde/outros) no custo unitário |
| **Modo simulação** | Garantia de não gravar em cadastro oficial |

---

## Referências internas

- `docs/projects/PROJECT_PRICING.md`
- `docs/projects/PROJECT_COST_AMORTIZATION.md`
- `docs/projects/PROJECT_EXECUTIVE_REPORT.md`
- `src/lib/projectsModuleAudit.ts` — matriz tipada de funcionalidades
