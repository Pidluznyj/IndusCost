# OP-15 — Auditoria da arquitetura da tela de Ordens de Produção

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Prompt** | OP-15 — Auditoria (sem implementação funcional) |
| **Data** | 2026-07-16 |
| **Escopo** | Consulta e auditoria visual — **sem** criação/edição/liberação/encerramento/cancelamento de OP |
| **Fonte de dados** | PostgreSQL local (`NomusProductionOrder`, `NomusProductionOrderSalesLink`) — **nunca** API Nomus no browser |

Documentos irmãos:

- [`release-candidate.md`](./release-candidate.md) — regressão OP-01…OP-14
- [`target-architecture.md`](./target-architecture.md) — arquitetura-alvo da integração
- [`operations.md`](./operations.md) — sync/backfill operacional
- [`api-contract.md`](./api-contract.md) — contrato Nomus `/rest/ordens`
- [`../design-system/overlay.md`](../design-system/overlay.md) — drawer canônico

---

## 1. Checklist How it works / YAGNI + reutilização

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Isso realmente precisa existir? | **Sim.** Sync/backfill (OP-01…OP-14) populam stage local; hoje a OP só aparece embutida no raw do pedido comercial ou como badge agregado — operação não tem consulta dedicada. |
| 2 | Já existem página/tabela/grid/paginação/filtros/badges/drawer reutilizáveis? | **Sim.** Estoque (`InventoryItemsTab`) = referência de listagem server-side; Frota (`FleetReservationsTab`) = paginação + filtros; Overlay DS = drawer canônico; Comercial = badges OP (`formatProductionBadge`). |
| 3 | Já existe rota/menu/resource em Operações? | **Parcial.** Grupo `operacoes` com 6 módulos; **não** há item OP, rota `/production-orders` nem `operations.production_orders`. |
| 4 | O banco já possui todas as informações necessárias? | **Sim para consulta v1.** Cabeçalho OP + vínculos pedido/item + FKs opcionais para `SalesOrder`/`SalesOrderItem`. **Não** há quantidade produzida/pendente normalizada no stage. |
| 5 | Existe endpoint/repository reutilizável? | **Repository de persistência/sync sim; HTTP read-only não.** Reutilizar resolvers de `nomusProductionOrdersLookup.server.ts` (`resolveLinkLocals`, `listPendingLinks`). |
| 6 | Alguma regra está sendo duplicada? | **Risco atual:** `salesOrderIntelligence.ts` lê OP do `nomusRawResponse` (raw embutido), não do stage. A nova tela **deve** usar só stage; migrar intelligence comercial é prompt separado (evitar duplicar lógica de badge/atraso). |
| 7 | Menos código / menor acoplamento? | **Sim:** um módulo read-only, 2 endpoints GET, permissão `view` única, sem tabs operacionais, sem mutação Nomus, sem tocar Pedido/NF-e/AR/AP/Fluxo/Comissões/Precificação/BOM/Relatório Presidencial. |

---

## 2. Menu Operações (estado atual)

### 2.1 Grupo sidebar

Definido em `src/lib/navigationGroups.ts`:

| moduleId | Label | Path | resourceKey |
|----------|-------|------|-------------|
| `inventory` | Estoque / Almoxarifado | `/inventory` | `operations.inventory` |
| `purchases` | Compras | `/purchases` | `operations.purchases` |
| `machines` | Máquinas | `/machines` | `operations.machines` |
| `operations-performance` | Performance | `/operations-performance` | `operations.performance` |
| `maintenance` | Manutenção Predial | `/maintenance` | `operations.maintenance` |
| `fleet` | Gestão de Frota | `/fleet` | `operations.fleet` |

Ícone do grupo: `Factory` (`Sidebar.tsx`). Ordem do grupo: `order: 5`.

### 2.2 Lacuna OP

- `AppModuleId` em `modulePermissions.ts` **não** inclui `production-orders`.
- `OPERATIONS_RESOURCE_KEYS` em `operationsAccess.ts` **não** inclui chave OP.
- `permissionsClient.ts` / `sidebarMenuResources.ts` — sem filho `operations.production_orders`.
- Nenhuma rota em `App.tsx` para OP.

### 2.3 Recomendação de encaixe

| Decisão | Valor recomendado |
|---------|-------------------|
| `AppModuleId` | `production-orders` |
| Label menu | **Ordens de Produção** |
| Label curta sidebar | **OPs** (`sidebarLabels.ts`) |
| Path | `/production-orders` |
| Grupo | `operacoes` — inserir após `operations-performance` ou antes de `maintenance` (ordem operacional: produção entre performance e manutenção) |
| Ícone lucide | `Factory` (grupo) / `ClipboardList` ou `Cog` (item) |
| resourceKey | **`operations.production_orders`** |
| Actions contrato | **`view` apenas** (consulta read-only) |

---

## 3. Padrão oficial de rotas operacionais

### 3.1 Frontend

| Padrão | Exemplo | Aplicar em OP |
|--------|---------|---------------|
| Rota top-level | `/inventory`, `/fleet` | `/production-orders` |
| Module shell | `InventoryModule.tsx`, `FleetModule.tsx` | `ProductionOrdersModule.tsx` (lista + drawer) |
| Sub-rotas por tab | `/inventory/items`, `/fleet/vehicles` | **Não necessário v1** — consulta única |
| Registro | `App.tsx` `<Route path="/production-orders" …>` | Sim |

### 3.2 Backend

| Padrão | Exemplo | Aplicar em OP |
|--------|---------|---------------|
| Prefixo API | `/api/inventory/*`, `/api/operations/performance/*` | **`/api/operations/production-orders`** |
| Guard | `[requireAppAuth, requireResource(key, "view")]` | `operations.production_orders` |
| Query parser dedicado | `inventoryListQuery.ts` | `productionOrdersListQuery.ts` (puro, testável) |
| Registro | `registerInventoryRoutes` / `registerComponentPerformanceRoutes` | `registerProductionOrdersRoutes` (novo, isolado) |

**Referência canônica de listagem:** `src/lib/inventory/inventoryListQuery.ts` + `src/lib/inventoryRoutes.ts` (`GET /api/inventory/items`).

---

## 4. Padrão de tabelas (paginação, filtros, estados)

### 4.1 Inventário — template preferido

`src/components/inventory/InventoryItemsTab.tsx`:

| Concern | Implementação |
|---------|---------------|
| Paginação server-side | `page`, `pageSize` (default 50), `total`, `totalPages` |
| Reset de página | `useEffect` → page=1 quando filtros mudam |
| Filtros | query params → `URLSearchParams` |
| Loading | `<InventoryLoading />` |
| Empty | `<InventoryEmptyState />` com copy contextual |
| Error | `<InventoryErrorBanner />` + `formatInventoryApiError()` |
| Kit UI | `src/components/inventory/inventoryUi.tsx` |

Resposta API inventário:

```json
{ "rows": [], "total": 0, "page": 1, "pageSize": 50, "totalPages": 1 }
```

### 4.2 Alternativas existentes

| Módulo | Paginação | Observação |
|--------|-----------|------------|
| Frota | server `page`/`limit` | `FleetListPagination`, `FleetEmptyState` |
| Manutenção | server `page`/`pageSize` | inline spinner/empty |
| Performance | server `limit`/`offset` | presets de filtro |
| Compras | **client-side** | evitar — dataset pode crescer |

### 4.3 Recomendação OP

Espelhar **Inventário** (não Compras). Criar helpers mínimos `productionOrdersUi.tsx` (loading/empty/error/pagination) — **não** importar kit de estoque para evitar acoplamento cross-module; copiar padrão visual, não o módulo inteiro.

---

## 5. Padrão de drawer lateral

### 5.1 Design system (preferido)

Documentado em `docs/design-system/overlay.md`:

```
Overlay → OverlayHeader → [OverlayTabs] → OverlayBody → OverlayFooter
```

Componentes: `@/src/components/ui/overlay` — `OverlayBadge`, `OverlayTable`, `OverlayKpiCardGrid`.

Adoção ainda baixa; único consumidor real: `MaterialIntelligenceMarketQuoteModal.tsx`.

### 5.2 Legado dominante

Drawers custom com `createPortal` + painel direito fixo. Referências read-only:

| Arquivo | Uso |
|---------|-----|
| `PortfolioReconciliationOrderDrawer.tsx` | fetch on open, abort, seções, badges |
| `OrderStatusPedidosDrawer.tsx` | evidência financeira read-only |
| `SalesOrderIntelligenceDrawer.tsx` | abas + KPI + produção (hoje raw) |

### 5.3 Recomendação OP

Usar **Overlay DS** para drawer de detalhe (consulta densa, badges, tabela de vínculos). Sem formulário — sem `OverlayFooter` com ações de mutação; opcional link “Abrir pedido” como `<Link>` no header.

---

## 6. Padrão de badges executivos (status)

### 6.1 Comercial (OP agregada no pedido)

`src/lib/salesOrderManagementUi.ts` → `formatProductionBadge()`:

| Entrada | Texto |
|---------|-------|
| Sem OP | `Sem OP` |
| Com label | label do lifecycle |
| Atrasada | `OP atrasada` |
| Finalizada | `OP finalizada` |
| Status contém “produ”/“andamento” | `OP em produção` |
| Cancelado/devolvido | `Não aplicável` |

Classes visuais: `badgeClass("op")` em `SalesOrderManagementPage.tsx` (rounded-full, uppercase).

### 6.2 Overlay / finance

`OverlayBadge` — tons `sky|emerald|amber|rose|violet|slate|primary`.

### 6.3 Recomendação OP (lista + drawer)

| Campo DB | Badge |
|----------|-------|
| `NomusProductionOrder.status` | **Texto Nomus literal** (`Encerrada`, `Em produção`, …) — sem enum inventado |
| Tom visual | Heurística leve no **frontend** (contains `encerr`, `cancel`, `produ`) → mapear para `OverlayBadge` tone |
| Atraso | **Não persistido.** Opcional v1: `plannedAt < now && closedAt == null` → badge âmbar “Prevista vencida” — **somente display**, sem nova regra de negócio |
| Vínculo pendente | `salesOrderId == null \|\| salesOrderItemId == null` → badge `Pendente sync pedido` |
| Vínculo removido | `isCurrent == false` → badge `Removido` + `removedAt` |

**Não reutilizar** `formatProductionBadge` diretamente na grid OP — ela assume contexto de pedido (`hasOp`, `isLate` do lifecycle). Extrair helper **novo** `formatProductionOrderStatusBadge(status: string | null)` se necessário, sem alterar Comercial neste ciclo.

---

## 7. Padrão de APIs somente leitura

### 7.1 Estrutura comum

```text
register*Routes(app, { requireAppAuth, requireResource })
  → parse*ListQuery(req.query)
  → prisma.findMany({ skip, take, where, orderBy })
  → prisma.count({ where })
  → res.json({ rows, page, pageSize, total, totalPages })
```

### 7.2 Endpoints necessários (novos)

| Método | Path | Guard | Descrição |
|--------|------|-------|-----------|
| `GET` | `/api/operations/production-orders` | `operations.production_orders` + `view` | Lista paginada + filtros |
| `GET` | `/api/operations/production-orders/:id` | idem | Detalhe + `salesLinks[]` + joins opcionais |

**Não criar:** POST/PUT/DELETE, preview/apply, proxy Nomus.

### 7.3 Shape de resposta recomendado

**Lista** — linha agregada (1 row por OP):

```typescript
type ProductionOrderListRow = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  tipo: string | null;
  priority: string | null;
  productCode: string | null;
  productDescription: string | null;
  quantity: string | null; // Decimal serializado
  unit: string | null;
  openedAt: string | null;
  plannedAt: string | null;
  closedAt: string | null;
  syncedAt: string;
  lastSeenAt: string;
  // agregados de vínculo (evita N+1 na grid)
  linkCount: number;
  currentLinkCount: number;
  pendingLinkCount: number;
  primaryOrderCode: string | null;      // SalesOrder.orderCode se resolvido
  primaryExternalSalesOrderId: number | null;
  primaryCustomerName: string | null;   // link.customerName ou Customer
};
```

**Detalhe** — espelho do model + links enriquecidos:

```typescript
type ProductionOrderDetail = {
  header: /* campos NomusProductionOrder serializados */;
  salesLinks: Array<{
    id: string;
    externalSalesOrderId: number;
    externalSalesOrderItemId: number;
    itemNumber: string | null;
    customerName: string | null;
    linkedQuantity: string | null;
    isCurrent: boolean;
    removedAt: string | null;
    salesOrderId: string | null;
    salesOrderItemId: string | null;
    orderCode: string | null;
    skuSnapshot: string | null;
    productNameSnapshot: string | null;
  }>;
};
```

### 7.4 Repository reutilizável

| Existente | Reuso |
|-----------|-------|
| `nomusProductionOrdersRepository.server.ts` | Upsert only — **não** list |
| `nomusProductionOrdersLookup.server.ts` → `createDefaultProductionOrdersLookupLocalResolver` | **`resolveLinkLocals`**, **`listPendingLinks`** — extrair para módulo read compartilhado ou importar no route handler |
| `nomusProductionOrdersMapper.ts` | Tipos `MappedNomusProductionOrder*` — referência de campos, não HTTP |

---

## 8. Permissões (resource keys + requireResource)

### 8.1 Padrão atual Operações

`src/lib/operationsAccess.ts` — matriz piloto documentada; `requireResource` em `src/lib/security/requireResource.ts`.

### 8.2 Nova chave recomendada

| Campo | Valor |
|-------|-------|
| resourceKey | `operations.production_orders` |
| label catálogo | Ordens de Produção |
| parentKey | `operations` |
| actions | `view` |
| legacyPermission (seed) | `operations.production-orders.view` (espelhar padrão `operations.component-performance.view`) |

Arquivos a tocar nos próximos prompts (não neste):

- `permissionsClient.ts` (ResourceKeys + catálogo)
- `sidebarMenuResources.ts`
- `operationsAccess.ts`
- `navigationGroups.ts` + `modulePermissions.ts`
- `permissionContract/resources.ts` (endpoint map)

### 8.3 Frontend

```typescript
permissions.canPerformAction("operations.production_orders", "view")
```

Espelhar `OperationsPerformanceModule.tsx`.

---

## 9. Navegação para Pedido de Venda

### 9.1 Rotas existentes

| Path | Uso |
|------|-----|
| `/sales-orders` | Lista comercial |
| `/sales-orders/:id` | Detalhe (`SalesOrdersModule`) |
| `/sales-orders/management` | Grid executivo (badge OP) |

### 9.2 Deep link a partir da OP

Quando `salesLinks[].salesOrderId` resolvido:

```tsx
<Link to={`/sales-orders/${salesOrderId}`}>PD {orderCode}</Link>
```

Padrão usado em Comissões, Material Demand, `SalesOrderMarginDetailDrawer.tsx`.

**Sem** rota inversa dedicada (`/sales-orders/:id/production-orders`) na v1 — YAGNI.

---

## 10. Campos reais no banco

### 10.1 `NomusProductionOrder`

| Campo Prisma | Origem Nomus / significado | Exibir na UI |
|--------------|---------------------------|--------------|
| `externalId` | `id` | Sim — ID Nomus |
| `name` | `nome` (ex.: `OP 05800 - 003`) | Sim — coluna principal |
| `status` | `status` (string livre) | Sim — badge |
| `tipo` | `tipo` | Sim |
| `priority` | `prioridade` | Sim |
| `externalProductId` | `idProduto` | Opcional (técnico) |
| `productCode` | `produto` | Sim |
| `productDescription` | `descricaoProduto` | Sim |
| `productAdditionalInfo` | `informacaoAdicionalProduto` | Drawer |
| `productConfigId` / `productConfigCode` | config produto | Drawer (secundário) |
| `externalCompanyId` / `companyName` | `idEmpresa` / `empresa` | Drawer — **empresa emissora**, não cliente |
| `quantity` / `unit` | `quantidade` / `unidade` | Sim |
| `stockSector` | `setorEstoque` | Drawer |
| `openedAt` | `dataHoraCriacao` | Sim |
| `releasedAt` | `dataHoraLiberacao` | Sim |
| `plannedAt` | `dataHoraInicialPlanejada` | Sim |
| `deliveryAt` | `dataHoraEntrega` | Sim |
| `closedAt` | encerramento oficial (raro) | Não inferir de entrega/edição |
| `nomusUpdatedAt` | `dataHoraEdicao` | Sim |

Ver `docs/production-orders/date-field-mapping.md`.
| `rawJson` | payload integral | Drawer “payload” colapsável (opcional) |
| `payloadHash` | hash estável | Não (auditoria técnica) |
| `firstSeenAt` / `lastSeenAt` / `lastChangedAt` / `syncedAt` | metadados sync | Drawer metadados |

### 10.2 `NomusProductionOrderSalesLink`

| Campo | Origem | Exibir |
|-------|--------|--------|
| `productionOrderExternalId` | denormalizado | Drawer técnico |
| `externalSalesOrderId` | `itensPedido[].idPedido` | Sim |
| `externalSalesOrderItemId` | `itensPedido[].id` | Sim |
| `itemNumber` | `itensPedido[].item` | Sim |
| `customerName` | `itensPedido[].nomeCliente` | Sim |
| `linkedQuantity` | `itensPedido[].quantidade` | Sim |
| `salesOrderId` / `salesOrderItemId` | FK local | Navegação se não null |
| `isCurrent` | sync | Badge |
| `removedAt` | sync | Sim se removido |
| `rawJson` | item bruto | Opcional drawer |

### 10.3 `SalesOrder` (join para navegação)

| Campo | Identifica | Exemplo fixture |
|-------|------------|-----------------|
| `orderCode` | **Código do pedido (oficial local)** | `PD 02534` |
| `externalSalesOrderId` | ID Nomus pedido | `2530` |
| `nomusSellerName` / `responsible` | **Vendedor** | join quando FK resolvida |
| `issueDate` | Emissão | drawer link enriquecido |
| `expectedDeliveryDate` | Entrega prevista | drawer |
| `status` | Status comercial IndusCost | drawer (somente leitura) |
| `Customer.companyName` / `tradeName` | **Cliente** (preferir sobre `customerName` do link quando FK ok) | — |

### 10.4 `SalesOrderItem` (join)

| Campo | Identifica | Exemplo |
|-------|------------|---------|
| `nomusItemExternalId` | ID item Nomus | `11324` |
| `nomusItemSequence` | Número/sequência item | — |
| `skuSnapshot` | **Produto (SKU)** | — |
| `productNameSnapshot` | **Produto (nome)** | — |
| `quantity` | Qtd pedida | drawer comparativo |
| `nomusItemStatusNormalized` | Status atendimento | drawer (somente leitura) |

### 10.5 Mapeamento oficial (caso real documentado)

| Conceito | Valor | Campo |
|----------|-------|-------|
| OP | `OP 05800 - 003` | `NomusProductionOrder.name` |
| externalId OP | `30347` | `NomusProductionOrder.externalId` |
| Pedido externo | `2530` | `NomusProductionOrderSalesLink.externalSalesOrderId` |
| Código pedido | `PD 02534` | `SalesOrder.orderCode` |
| Item externo | `11324` | `NomusProductionOrderSalesLink.externalSalesOrderItemId` |
| Nº item | `00010` | `NomusProductionOrderSalesLink.itemNumber` |
| Cliente | `Esmaltec S/A` | `NomusProductionOrderSalesLink.customerName` |
| Qtd OP | `15400` | `NomusProductionOrder.quantity` |
| Qtd vínculo | `15000` | `NomusProductionOrderSalesLink.linkedQuantity` |

Fixture: `src/lib/fixtures/nomusProductionOrderOp05800.ts`.

---

## 11. Campos que **não existem** — não inventar

| Campo / conceito | Onde aparece hoje | Decisão UI |
|------------------|-------------------|------------|
| `producedQuantity` | raw intelligence | **Não exibir** ou mostrar “—” |
| `pendingQuantity` | calculado no raw | **Não exibir** |
| `startedAt` | raw intelligence | **Não exibir** |
| Status OP normalizado (enum) | não persistido | Usar `status` string Nomus |
| `isLate` persistido | lifecycle comercial | Calcular opcional no front; não gravar |
| Ações OP (liberar/encerrar/cancelar) | API Nomus write | **Fora de escopo** |
| Vendedor no cabeçalho OP | — | Só via join `SalesOrder` |
| Cliente no cabeçalho OP | — | Via link ou join; `companyName` da OP é **empresa**, não cliente |
| BOM / custo / movimentação estoque | outros domínios | **Não misturar** nesta tela |
| SyncState dedicado | não existe | Usar `syncedAt` / `IntegrationRun` (consulta admin separada) |

---

## 12. Especificação funcional recomendada (v1 consulta)

### 12.1 Filtros mínimos

| Filtro | Query param | Implementação |
|--------|-------------|---------------|
| Busca textual | `search` | `ILIKE` em `name`, `productCode`, `productDescription` |
| Status | `status` | igualdade ou `in` (valores distintos do banco) |
| Tipo | `tipo` | igualdade |
| Prioridade | `priority` | igualdade |
| Com pedido | `hasSalesLink=true\|false` | exists em `salesLinks` |
| Vínculo pendente | `pendingLink=true` | link com FK null |
| Só vínculos atuais | `currentLinksOnly=true` (default) | `salesLinks.some({ isCurrent: true })` |
| Pedido externo | `externalSalesOrderId` | filtro em link |
| Código pedido | `orderCode` | join `SalesOrder.orderCode` |
| Produto | `productCode` | cabeçalho |
| Abertura | `openedFrom` / `openedTo` | range em `openedAt` |
| Sync | `syncedFrom` / `syncedTo` | range em `syncedAt` |

### 12.2 Colunas do grid

| Coluna | Fonte | Ordenável |
|--------|-------|-----------|
| OP | `name` | sim (`name`) |
| Status | `status` | sim |
| Produto | `productCode` + trunc `productDescription` | sim (`productCode`) |
| Quantidade | `quantity` + `unit` | sim (`quantity`) |
| Tipo | `tipo` | sim |
| Pedido | `primaryOrderCode` ou ext. ID | via join |
| Cliente | `primaryCustomerName` | não (denormalizado) |
| Abertura | `openedAt` | sim (default desc) |
| Prevista | `plannedAt` | sim |
| Vínculos | `currentLinkCount` / `linkCount` | não |
| Sync | `lastSeenAt` | sim |

Clique na linha → abre drawer detalhe (sem navegação full-page na v1).

### 12.3 Estrutura do drawer

| Seção | Conteúdo |
|-------|----------|
| **Header** | `name`, badge `status`, `externalId` |
| **KPI** | quantidade, unidade, tipo, prioridade, setor estoque |
| **Datas** | abertura, prevista, encerramento, alteração Nomus, último sync |
| **Empresa** | `companyName` (emissora) |
| **Aba Vínculos** | tabela: pedido (link), item, cliente, qtd vínculo, status vínculo, botão “Abrir pedido” |
| **Aba Produto** | código, descrição, info adicional, config |
| **Metadados** | `firstSeenAt`, `lastSeenAt`, `payloadHash` (copiar — opcional admin) |

Sem aba de edição. Sem botões de sync (sync permanece CLI/cron).

### 12.4 Paginação

| Parâmetro | Default | Max |
|-----------|---------|-----|
| `page` | 1 | — |
| `pageSize` | 50 | 200 |
| `sortBy` | `openedAt` | whitelist: `name`, `status`, `productCode`, `quantity`, `openedAt`, `plannedAt`, `closedAt`, `syncedAt`, `lastSeenAt` |
| `sortOrder` | `desc` | `asc` \| `desc` |

Resposta:

```json
{
  "rows": [],
  "page": 1,
  "pageSize": 50,
  "total": 0,
  "totalPages": 1
}
```

### 12.5 Busca

- Trim via `safeTrim` (padrão inventário).
- Mínimo 2 caracteres para disparar ILIKE (evitar full scan acidental).
- Índices existentes: `name`, `productCode`, `status`, `openedAt`, `syncedAt` — suficientes para v1.

---

## 13. Riscos de performance

| Risco | Mitigação |
|-------|-----------|
| Join `SalesOrder` + `Customer` por linha | Agregar no SQL/subquery; denormalizar `primaryOrderCode` na listagem |
| OP com vários vínculos | Grid mostra contagem + primário; detalhe lista todos |
| `search` sem índice trigram | v1: prefix/ILIKE; monitorar; GIN/trigram só se necessário |
| Ordenação por campo join | Whitelist só campos do cabeçalho OP na v1 |
| Serializar `rawJson` grande na lista | **Nunca** na lista; só no detalhe sob demanda |
| Volume total de OPs | Paginação obrigatória; sem export v1 |

---

## 14. Isolamento de domínio (confirmado)

A tela OP **não altera**:

- Pedido de Venda, NF-e, Documento de Saída, AR, AP, Fluxo de Caixa
- Comissões, Precificação, BOM, Relatório Presidencial

Leitura de `SalesOrder` / `SalesOrderItem` é **join read-only** para exibição e deep link.

---

## 15. Plano dos próximos prompts

| Prompt | Entrega | Depende de |
|--------|---------|------------|
| **OP-16** | API read-only: `GET` lista + detalhe, `productionOrdersListQuery.ts`, testes puros | OP-15 |
| **OP-17** | Permissão `operations.production_orders`, menu Operações, rota `App.tsx`, guards | OP-16 |
| **OP-18** | UI grid consulta (module shell, filtros, paginação, estados) | OP-17 |
| **OP-19** | Drawer detalhe (Overlay DS, vínculos, link pedido) | OP-18 |
| **OP-20** | (Opcional) Migrar `salesOrderIntelligence` para stage local — eliminar duplicação raw vs stage | OP-16 |

Cada prompt: YAGNI, `npm test` / build, commit focado, **sem** mutação Nomus, **sem** movimentações/reportes operacionais.

---

## 16. Referências de código

| Tema | Path |
|------|------|
| Menu Operações | `src/lib/navigationGroups.ts` |
| Permissões ops | `src/lib/operationsAccess.ts` |
| Listagem inventário | `src/components/inventory/InventoryItemsTab.tsx` |
| Query parser | `src/lib/inventory/inventoryListQuery.ts` |
| Overlay drawer | `docs/design-system/overlay.md` |
| Badge OP comercial | `src/lib/salesOrderManagementUi.ts` |
| Intelligence (raw hoje) | `src/lib/salesOrderIntelligence.ts` → `mapProductionOrders` |
| Persistência/sync | `src/lib/nomusProductionOrdersRepository.server.ts` |
| Resolver FK local | `src/lib/nomusProductionOrdersLookup.server.ts` |
| Schema | `prisma/schema.prisma` → `NomusProductionOrder*` |
| Fixture real | `src/lib/fixtures/nomusProductionOrderOp05800.ts` |
