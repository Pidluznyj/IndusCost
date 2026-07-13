# Plano técnico — aba Status Pedidos (Conciliação de Carteira)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Módulo** | Financeiro → Conciliação de Carteira → **Status Pedidos** |
| **Data** | 2026-07-13 |
| **Escopo deste prompt** | Inventário + contrato — **sem** novo endpoint, **sem** UI nova, **sem** migration, **sem** alterar cálculo O2C existente |
| **Fonte canônica** | `OrderToCashAuditRun` + `OrderToCashAuditFact` |
| **Run geral de referência** | `41c2470a-b685-4765-a954-77110fd8cf5c` (SUCCESS · 1283 pedidos · 5860 facts) |
| **Caso crítico** | PD 02534 / Esmaltec / NF 7228 — item `309.86AA` PENDING não pode parecer faturado |

Documentos relacionados:

- `docs/finance/order-to-cash-audit-item-evidence-rules.md`
- `docs/finance/portfolio-reconciliation-tabs-inventory.md`
- `docs/finance/portfolio-reconciliation-tabs-data-source-plan.md`
- `docs/sales/order-to-cash-audit-schema.md` (se presente)

---

## 1. Objetivo da aba

Exibir o **status consolidado por Pedido de Venda** da jornada Pedido → Documento → NF → Contas a Receber → Caixa, com visão executiva:

- **Cards** contam **pedidos distintos** (nunca linhas de `OrderToCashAuditFact`).
- **Tabela** tem **uma linha por pedido**.
- **Drawer** (próximos prompts) mostra itens/evidências.
- Backend agrega; frontend só exibe.
- Não altera Contas a Receber oficial, Fluxo de Caixa, Comissões, Relatório Presidencial, sync Nomus nem regra de comissionamento.
- Não usa Propostas como fonte oficial.
- Não importa Prisma no frontend.

---

## 2. Diferença entre Auditoria Pedido → Caixa e Status Pedidos

| | **Auditoria Pedido → Caixa** | **Status Pedidos** |
|---|---|---|
| Grain | Item / evidência (`OrderToCashAuditFact`) | Pedido de Venda (agregação) |
| Linha da tabela | 1 fato (alocação, PENDING, excedente, extra…) | 1 pedido |
| Cards | Totais da run **ou** resumo filtrado (pode citar `totalFacts` / linhas) | Contam **apenas** pedidos distintos + status consolidados |
| CR | Título pode aparecer por linha (com `titleReceivable*` em PENDING) | CR agregado **1× por pedido** (`Math.max` / dedupe) |
| Valor de produto | `lineBilledValue` por evidência de item | Soma segura de cobrado por item; **nunca** CR total / NF cabeçalho |
| Uso | Diagnóstico técnico / rastreabilidade | Visão gerencial de carteira / atendimento / CR |

Regra conceitual: Auditoria = evidência; Status Pedidos = consolidado.

---

## 3. Fonte de dados

### 3.1 Primária

| Tabela | Papel |
|--------|--------|
| `OrderToCashAuditRun` | Metadados da materialização (status, totais, escopo cliente/ano) |
| `OrderToCashAuditFact` | Linhas de evidência — **insumo** da agregação; não são “pedidos” |

Política de run (reutilizar `decideOrderToCashAuditRunPolicy`):

1. `runId` explícito, se informado  
2. Run específica SUCCESS (`customerFilter` = `customerExternalId` + `year`)  
3. Run geral SUCCESS (`customerFilter = null`) — ex.: run `41c2470a-…`  
4. Sem run → empty state claro  

### 3.2 Inventário das abas atuais (leitura)

| Aba | Entry | Client | API server |
|-----|--------|--------|------------|
| Conciliação | `FinancePortfolioReconciliationPage` + `PortfolioReconciliation*` | `financePortfolioReconciliationClient` | `financePortfolioReconciliationApi.server` (O2C → adapter → `aggregateFactsToOrderRows`) |
| Inteligência | `PortfolioIntelligenceSection` + cards/grid/drawer | mesmo client (intelligence) | mesmo server + `portfolioMaturityIntelligenceApi` |
| Auditoria Pedido → Caixa | `OrderToCashAuditTab` + filters/cards/table | `orderToCashAuditClient` | `financeOrderToCashAuditApi.server` + `orderToCashAuditApi` |
| Status Pedidos (provisório) | `OrderStatusPedidosTab` + filters/cards/table/drawer | `orderStatusPedidosClient` | `financeOrderStatusPedidosApi.server` + `orderStatusPedidosApi` |

Adapters / APIs relacionados:

| Módulo | Caminho | Uso para Status Pedidos |
|--------|---------|-------------------------|
| `orderToCashAuditApi` | `src/lib/finance/orderToCashAuditApi.ts` | FactRecord, filtros, `lineBilledValue`, resumo CR `Math.max` |
| `orderToCashAuditClient` | `src/lib/finance/orderToCashAuditClient.ts` | Padrão de query/ano/cliente (referência UI) |
| `orderToCashAuditToPortfolioFactsAdapter` | `src/lib/finance/orderToCashAuditToPortfolioFactsAdapter.ts` | CR 1× no primeiro fato — referência de dedupe |
| `portfolioReconciliationApi` | `src/lib/finance/portfolioReconciliationApi.ts` | `aggregateFactsToOrderRows` (grain pedido, mas status ≠ contrato Status Pedidos) |
| `portfolioMaturityIntelligenceApi` | `src/lib/finance/portfolioMaturityIntelligenceApi.ts` | Cards/drilldowns maturidade — referência de layout, não de status |

### 3.3 Campos em `OrderToCashAuditFact` para consolidar

| Campo | Prisma | FactRecord / FACT_SELECT atual | Uso na agregação |
|-------|--------|--------------------------------|------------------|
| `salesOrderId` | Sim | Sim | Chave preferencial do pedido |
| `orderCode` | Sim | Sim | Exibição + fallback de chave |
| `orderIssueDate` | Sim | Sim | Filtro ano / sort |
| `orderExpectedDeliveryDate` | Sim | Sim | FUTURO vs ATRASADO |
| `customerName` / `externalCustomerId` | Sim | Sim | Filtros / linha |
| `sellerName` | Sim | Sim | `orderSellerName` |
| `productCode` / `lineType` | Sim | Sim | Contagem pendente vs alocado |
| `orderItemTotalValue` | Sim | Sim | Valor pedido / pendente (dedupe por item) |
| `allocatedValueByOrderPrice` / `ByDocumentPrice` | Sim | Sim | Alocado |
| `lineBilledValue` | **Não** (calculado) | Em `OrderToCashAuditListRow` via `resolveOrderToCashAuditLineBilledValue` | Soma só evidência de item |
| `receivableTotal/Open/Received` | Sim | Sim | CR 1× (não PENDING) |
| `operationalStage` / `financialStage` / `orderToCashStage` | Sim | Sim | Status operacional/financeiro/consolidado |
| `temperature` / `confidenceScore` | Sim | Sim | Linha / cards |
| `alertsJson` | Sim | Sim | Alertas / card divergência |
| `fiscalStage` | Sim | **Ainda não** no FACT_SELECT Status/Auditoria list | Necessário para `fiscalStatus` / `NF_SEM_CR` |
| `commercialStage` | Sim | **Ainda não** selecionado | Apoio a CANCELADO / carteira |
| `responsibleArea` | Sim | Sim | Área (não pessoa) |
| Responsável comercial (pessoa) | **Não** no Fact | — | `commercialResponsibleName`: null até existir fonte segura (não inventar) |

---

## 4. Contrato da API (alvo)

> **Contrato-alvo dos próximos prompts.**  
> Implementação provisória atual usa `GET .../order-status-pedidos` com payload `{ summary, rows, page… }` e 6 status grosseiros — deve ser **alinhada** a este contrato (path, shape, taxonomia).

### 4.1 Endpoint

```http
GET /api/finance/portfolio-reconciliation/order-status
```

Somente leitura. Permissão sugerida: `financeiro.conciliacao_carteira.tab.status_pedidos` (já seedada).

### 4.2 Query params

| Param | Tipo | Obrigatório | Notas |
|-------|------|-------------|--------|
| `customerExternalId` | number | Não | Código Nomus; nunca filtrar Fact por `customerId` interno |
| `customerName` | string | Não | Fallback contains |
| `year` | number | **Sim** (UX) | Na run geral, aplica-se em `orderIssueDate` |
| `from` / `to` | date ISO | Não | Janela adicional sobre emissão (se informada, intersecta year) |
| `sellerName` | string | Não | `sellerName` do Fact |
| `responsibleName` | string | Não | Reservado; sem campo de pessoa no Fact → no-op ou 400 claro até existir fonte |
| `consolidatedStatus` | enum | Não | Ver §7 |
| `operationalStatus` | string | Não | Domínio operacional consolidado |
| `financialStatus` | string | Não | Domínio financeiro consolidado |
| `temperature` | string | Não | Do pedido (pior / dominante) |
| `alert` | string | Não | Código de alerta presente em `alerts` |
| `selectedCard` | string | Não | Id do card principal (§6) — estreita o universo |
| `selectedDrilldown` | string | Não | Id do drilldown (§8) |
| `page` | number | Não | Default 1 |
| `pageSize` | number | Não | Default 50; max 200 |
| `sortBy` | string | Não | Whitelist de colunas da linha |
| `sortDirection` | `asc` \| `desc` | Não | Default `desc` |

Opcional de diagnóstico (não obrigatório no contrato UI): `runId`.

### 4.3 Resposta esperada

```ts
type OrderStatusListResponse = {
  runMeta: {
    runId: string;
    status: string;
    mode: string | null;
    finishedAt: string | null;
    isGeneralRun: boolean;
    year: number | null;
    customerFilter: string | null;
    totalOrders: number;   // totais da run (referência)
    totalFacts: number;
  } | null;

  primaryCards: OrderStatusPrimaryCard[];
  /** Cards secundários / breakdowns derivados do filtro atual */
  drilldownCards: OrderStatusDrilldownCard[];

  rows: OrderStatusOrderRow[];

  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;   // = total de pedidos no universo filtrado
    totalPages: number;
  };

  sourceInfo: {
    summarySource: "aggregated_orders";
    grain: "sales_order";
    evidenceGrain: "order_to_cash_audit_fact";
    crAggregation: "max_per_order_excluding_pending_lines";
    lineBilledRule: "item_evidence_only";
    message: string | null;
  };
};

type OrderStatusPrimaryCard = {
  id: OrderStatusPrimaryCardId;
  label: string;
  count: number;           // pedidos distintos
  hint: string;
  tone: "neutral" | "green" | "blue" | "amber" | "gray" | "orange" | "red";
};

type OrderStatusDrilldownCard = {
  id: string;
  parentCardId: OrderStatusPrimaryCardId | null;
  label: string;
  count: number;
  hint: string;
};
```

`totalRows` da paginação = **número de pedidos**, nunca `totalFacts`.

---

## 5. Contrato da linha por pedido

```ts
type OrderStatusOrderRow = {
  salesOrderId: string | null;
  orderCode: string | null;
  orderIssueDate: string | null;              // ISO
  orderExpectedDeliveryDate: string | null;   // ISO
  customerName: string | null;
  externalCustomerId: number | null;

  /** Pessoa responsável comercial — null se não houver fonte no Fact */
  commercialResponsibleName: string | null;
  /** Vendedor do pedido (Fact.sellerName) */
  orderSellerName: string | null;

  totalOrderValue: number;        // orderNetValue 1× (ou soma dedupe itens)
  allocatedOrderValue: number;    // soma allocatedValueByOrderPrice (linhas alocadas)
  lineBilledValue: number;        // soma lineBilledValue de evidências ITEM (não PENDING)
  pendingOrderValue: number;      // soma orderItemTotalValue de linhas PENDING (dedupe item)
  fulfillmentPercent: number;     // 0–100; baseado em qty/valor alocado vs pedido (definir fórmula no prompt de cálculo)

  receivableTotalValue: number;   // CR título 1×
  receivableOpenValue: number;
  receivableReceivedValue: number;

  operationalStatus: string;      // consolidado a partir de operationalStage das linhas
  fiscalStatus: string;           // requer fiscalStage no select (próximo prompt)
  financialStatus: string;        // consolidado a partir de financialStage / CR
  consolidatedOrderStatus: OrderStatusConsolidatedStatus; // §7

  temperature: string | null;
  confidenceScore: number | null;
  alerts: string[];
  recommendedAction: string | null;
};
```

### 5.1 Sort whitelist sugerida

`orderCode`, `orderIssueDate`, `orderExpectedDeliveryDate`, `customerName`, `orderSellerName`, `totalOrderValue`, `allocatedOrderValue`, `lineBilledValue`, `pendingOrderValue`, `fulfillmentPercent`, `receivableTotalValue`, `receivableOpenValue`, `receivableReceivedValue`, `consolidatedOrderStatus`, `temperature`, `confidenceScore`.

---

## 6. Cards principais

Contagem = **pedidos distintos** no universo filtrado (após filtros de query, **antes** da paginação da tabela; card selection estreita o universo).

| Id | Label | Critério (alto nível) | Tom |
|----|-------|------------------------|-----|
| `total` | Total de pedidos | Todos os pedidos do universo | neutral |
| `completos` | Completos | Status ∈ `COMPLETO_*` | green |
| `parciais` | Parciais | Status ∈ `PARCIAL_*` | amber |
| `sem_atendimento` | Sem atendimento | Status ∈ `SEM_ATENDIMENTO_*` | gray |
| `com_divergencia` | Com divergência | Pedido com alertas de excedente / fora do pedido / preço / NF cabeçalho / doc sem CR (flag), **sem** confundir com valor de item | orange |
| `cr_aberto` | CR aberto | `receivableOpenValue > ε` (qualquer consolidado com CR aberto) | blue |
| `recebidos` | Recebidos | Status ∈ {`COMPLETO_RECEBIDO`, `PARCIAL_RECEBIDO`} **ou** received>0 e open≈0 | green |
| `bloqueados` | Bloqueados | Status = `BLOQUEADO_REVISAO` | red |

Hints obrigatórios nos tooltips (ex.): “Conta pedidos distintos, não linhas de evidência”; “CR aberto agregado 1× por pedido”.

---

## 7. Status consolidados

Taxonomia **alvo** (`consolidatedOrderStatus`):

| Status | Significado |
|--------|-------------|
| `COMPLETO_RECEBIDO` | Atendimento completo + CR baixado / caixa evidenciado |
| `COMPLETO_CR_ABERTO` | Completo operacionalmente + CR com saldo aberto |
| `COMPLETO_SEM_CR` | Completo (doc/NF) sem Contas a Receber seguro |
| `PARCIAL_RECEBIDO` | Itens pendentes ou parcial + recebimento parcial |
| `PARCIAL_CR_ABERTO` | Parcial + CR aberto (ex.: PD 02534) |
| `PARCIAL_SEM_CR` | Parcial sem CR |
| `SEM_ATENDIMENTO_FUTURO` | Sem alocação; entrega futura / saudável |
| `SEM_ATENDIMENTO_ATRASADO` | Sem alocação; entrega vencida / atraso |
| `NF_SEM_CR` | Há NF/documento fiscal sem CR |
| `BLOQUEADO_REVISAO` | Bloqueado / pedido antigo sem evolução |
| `CANCELADO` | Pedido cancelado (somente se evidência materializada no Fact / estágio) |

### 7.1 Prioridade de classificação (proposta)

Avaliar nesta ordem (primeiro match vence):

1. `CANCELADO`  
2. `BLOQUEADO_REVISAO`  
3. `NF_SEM_CR` (completo/parcial faturado sem CR — quando fiscal/financeiro indicar)  
4. Parcialidade: se há `ORDER_ITEM_PENDING` ou `hasPartialFulfillment` → ramo `PARCIAL_*`  
5. Completo: sem pendência e com alocação plena → ramo `COMPLETO_*`  
6. Sem alocação → `SEM_ATENDIMENTO_FUTURO` \| `SEM_ATENDIMENTO_ATRASADO` (por `orderExpectedDeliveryDate` vs hoje)  
7. Dentro de COMPLETO/PARCIAL: `*_RECEBIDO` se open≈0 e received>0; `*_CR_ABERTO` se open>ε; senão `*_SEM_CR`

**PD 02534:** deve resultar em `PARCIAL_CR_ABERTO` (item pendente + CR aberto + possível divergência em flags/alerts), **nunca** completo e **nunca** com `309.86AA` mostrando NF 7228 / CR título como valor do item.

### 7.2 Gap vs implementação provisória

Status atuais (provisórios): `RECEBIDO`, `CR_ABERTO`, `PARCIAL`, `SEM_ATENDIMENTO`, `DIVERGENCIA`, `BLOQUEADO`.  
Devem ser **substituídos** pela taxonomia §7 nos próximos prompts de cálculo/API.

---

## 8. Drilldowns

Drilldowns são cards secundários alimentados por `selectedCard` / `selectedDrilldown`. Contam pedidos distintos.

| parentCardId | drilldown id | Label | Filtro |
|--------------|--------------|-------|--------|
| `completos` | `completo_recebido` | Completo recebido | `COMPLETO_RECEBIDO` |
| `completos` | `completo_cr_aberto` | Completo CR aberto | `COMPLETO_CR_ABERTO` |
| `completos` | `completo_sem_cr` | Completo sem CR | `COMPLETO_SEM_CR` |
| `parciais` | `parcial_recebido` | Parcial recebido | `PARCIAL_RECEBIDO` |
| `parciais` | `parcial_cr_aberto` | Parcial CR aberto | `PARCIAL_CR_ABERTO` |
| `parciais` | `parcial_sem_cr` | Parcial sem CR | `PARCIAL_SEM_CR` |
| `sem_atendimento` | `sem_futuro` | Futuro | `SEM_ATENDIMENTO_FUTURO` |
| `sem_atendimento` | `sem_atrasado` | Atrasado | `SEM_ATENDIMENTO_ATRASADO` |
| `com_divergencia` | `excesso` | Excedente | alert/flag excess |
| `com_divergencia` | `fora_pedido` | Produto fora do pedido | flag outside order |
| `com_divergencia` | `preco` | Divergência de preço | flag price |
| `cr_aberto` | `cr_vencido` | CR vencido | `hasOverdueReceivable` no pedido |
| `bloqueados` | `bloqueado_revisao` | Bloqueado revisão | `BLOQUEADO_REVISAO` |
| `total` | `nf_sem_cr` | NF sem CR | `NF_SEM_CR` |
| `total` | `cancelados` | Cancelados | `CANCELADO` |

Frontend: clique no card principal seta `selectedCard`; clique no drilldown seta `selectedDrilldown` e atualiza a tabela.

---

## 9. Layout proposto

Padrão visual executivo (alinhado às abas existentes / BI financeiro):

1. **Cabeçalho da aba** — título “Status Pedidos”, subtítulo (visão por pedido), aviso de pesquisa sob demanda (ano obrigatório).  
2. **Filtros** — cliente (autocomplete Nomus), ano, período from/to, vendedor, status consolidado, temperatura, alertas; botões Pesquisar / Limpar.  
3. **Faixa `sourceInfo` / `runMeta`** — run geral vs específica, data, “agregação por pedido”.  
4. **Primary cards** — grade espaçada, borda suave, fundo claro, ícones discretos, tooltips (`hint`).  
5. **Drilldown cards** — segunda fileira (só quando um primary está selecionado).  
6. **Tabela** — uma linha/pedido; badges de status com cores: verde completo/recebido, azul CR aberto, âmbar parcial, cinza sem atendimento, laranja divergência, vermelho suave bloqueado.  
7. **Drawer** — resumo do pedido + lista de itens/evidências (reusar regras de evidência; PENDING sem NF/CR de item; CR título só como rastreabilidade).  
8. **Estados** — loading / empty (sem ano, sem run, sem pedidos) / error — **sem JSON cru**.

Não redesenhar Conciliação / Inteligência / Auditoria neste plano.

---

## 10. Riscos

| Risco | Mitigação |
|-------|-----------|
| Contar `totalFacts` como pedidos | Cards e `pagination.totalRows` só sobre set de `salesOrderId`/`orderCode` |
| Somar CR por linha de evidência | `Math.max` (ou dedupe por título) **excluindo** PENDING |
| Usar `nfeHeaderValue` / CR título como valor de produto | `lineBilledValue` só via `resolveOrderToCashAuditLineBilledValue`; PENDING = null |
| PD 02534 parecer completo/faturado | PENDING sem NF/CR item; status `PARCIAL_*`; teste de regressão obrigatório |
| Confundir com Conciliação / Inteligência | Contrato e labels próprios; não alterar endpoints oficiais dessas abas |
| `commercialResponsibleName` inexistente | Manter `null`; não inventar a partir de Propostas |
| `fiscalStage` fora do FACT_SELECT | Incluir no select **somente** no loader Status Pedidos (sem migration) nos prompts de API |
| Performance (5860 facts → 1283 pedidos) | Agregar no backend; exigir ano; paginar pedidos; não carregar no mount |
| Path provisório `order-status-pedidos` vs alvo `order-status` | Migrar/alias no prompt de endpoint; um único contrato público |
| Alterar cálculo do builder O2C | **Proibido** neste plano — só leitura + agregação display |

---

## 11. Critérios de aceite

1. Documentação publicada em `docs/finance/portfolio-order-status-tab-plan.md` (este arquivo).  
2. Contrato API (`/order-status`) e linha por pedido definidos (§4–§5).  
3. Taxonomia de 11 status e 8 cards principais definidos (§6–§7).  
4. Regras de agregação segura explícitas (pedido distinto, CR 1×, lineBilled só evidência).  
5. Diferença Auditoria × Status Pedidos clara (§2).  
6. PD 02534 citado como caso de aceite funcional nos prompts de cálculo/UI.  
7. Lista de arquivos dos próximos prompts (§12).  
8. **Neste prompt:** sem novo endpoint, sem UI nova, sem migration, sem mudança de cálculo do rebuild O2C.  
9. Validações de import/test/build verdes após o commit da documentação.

Aceite funcional da **aba** (UI + API alinhados a este contrato) fica para prompts seguintes.

---

## 12. Arquivos que serão alterados nos próximos prompts

### Prompt A — Cálculo / API pura (sem UI)

- `src/lib/finance/orderStatusPedidosApi.ts` (ou rename `orderStatusApi.ts`) — taxonomia §7, cards, drilldowns, row contract  
- `src/lib/finance/orderStatusPedidosApi.test.ts` — PD 02534 + CR 1× + contagem distinta  
- Possível extensão mínima de `OrderToCashAuditFactRecord` **somente se** necessário para `fiscalStage` (sem Prisma no frontend)

### Prompt B — Server + rota

- `src/lib/financeOrderStatusPedidosApi.server.ts` — FACT_SELECT (+ `fiscalStage`/`commercialStage` se preciso), loader list/detail  
- `src/lib/financePortfolioReconciliationRoutes.ts` — `GET .../order-status` (+ detalhe se mantido)  
- `src/lib/finance/orderStatusPedidosClient.ts` — path e query do contrato  

### Prompt C — UI

- `OrderStatusPedidosTab.tsx` / `Filters` / `SummaryCards` / `Table` / `Drawer`  
- `FinancePortfolioReconciliationPage.tsx` — só se wiring/testid mudar  

### Prompt D — Permissões / QA (se path ou labels mudarem)

- `permissionsClient.ts`, `permissionsCatalog.ts`, `permissionResourceSeedData.ts`  
- Testes: `permissionsClient.test.ts`, `permissionGuards.test.ts`, `financePortfolioReconciliationPage.test.ts`, `moduleTabPermissions.test.ts`  

### Não alterar (salvo necessidade explícita e aprovada)

- Builder/rebuild O2C (`orderToCashAuditBuilder`, `rebuildOrderToCashAudit`)  
- Contas a Receber / Fluxo / Comissões / Relatório Presidencial / sync Nomus  
- Schema Prisma / migrations  
- Contratos públicos das abas Conciliação, Inteligência e Auditoria (exceto reuso read-only)

### Já existente (provisório — alinhar, não duplicar)

Implementação inicial sob `order-status-pedidos` com 6 status. Próximos prompts devem **evoluir** esses arquivos para o contrato deste documento, evitando segunda aba paralela.

---

## 13. Regras de agregação segura (resumo normativo)

1. Chave do pedido: `salesOrderId` → senão `code:{orderCode}` → senão `fact:{id}` (último recurso).  
2. `totalOrderValue`: `orderNetValue` **uma vez** por chave (não somar por fact).  
3. `allocatedOrderValue`: somar `allocatedValueByOrderPrice` só em linhas com alocação (`quantityUsedForOrder > 0` ou equivalente).  
4. `lineBilledValue` (pedido): somar `resolveOrderToCashAuditLineBilledValue` das linhas **não** PENDING; PENDING contribui 0 / null.  
5. `pendingOrderValue`: soma deduplicada de `orderItemTotalValue` das linhas `ORDER_ITEM_PENDING`.  
6. CR (`receivable*`): `Math.max` por pedido usando apenas linhas **não** PENDING.  
7. NF na linha do pedido: lista distinta de `nfeNumber` de evidências ITEM; PENDING não adiciona NF.  
8. Nunca usar `nfeHeaderValue` como valor de item/produto.  
9. Nunca usar `receivableTotalValue` do título como valor de produto.  
10. Cards e paginação operam sobre o set de pedidos após filtros — não sobre facts.

---

## 14. Inventário rápido — estado em 2026-07-13

| Item | Estado |
|------|--------|
| Aba registrada em `PORTFOLIO_RECONCILIATION_UI_TABS` | Sim (`order-status-pedidos`) |
| Permissão `…tab.status_pedidos` | Sim (seed + catálogo) |
| Endpoint provisório | `…/order-status-pedidos` |
| Endpoint alvo deste plano | `…/order-status` |
| Taxonomia 11 status | **Não** (ainda 6 status) |
| `primaryCards` / `drilldownCards` / `sourceInfo` | **Não** (usa `summary`) |
| Cálculo rebuild O2C | Intocado por este plano |

Fim do plano.
