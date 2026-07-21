# OP-02 — Motor canônico operacional de Pedidos de Venda

**Projeto:** IndusCost / My Industry  
**Data:** 2026-07-20  
**Escopo:** população + métricas oficiais (leitura/consolidação)

## Arquitetura

| Camada | Arquivo | Responsabilidade |
|--------|---------|------------------|
| Types | `src/lib/salesOrderOperationalTypes.ts` | Contexto OPERATIONAL / HISTORICAL_AUDIT + definições de métricas |
| Metrics | `src/lib/salesOrderOperationalMetrics.ts` | Fórmulas oficiais + unicidade + anti-join cartesiano |
| Population (shared) | `src/lib/salesOrderOperationalPopulationShared.ts` | Presença sem Prisma client |
| Population | `src/lib/salesOrderOperationalPopulation.server.ts` | `where` canônico (list/management query) |
| Facts | `src/lib/salesOrderOperationalFacts.server.ts` | Header + NF agregados por `salesOrderId` |
| Engine | `src/lib/salesOrderOperationalEngine.server.ts` | Orquestra população → facts → métricas + observabilidade |

**Fonte de `where` operacional:** `buildSalesOrderListWhere` → `resolveSalesOrderListWhere` (presença Nomus no AND raiz).

## Definições oficiais

| Métrica | Definição |
|---------|-----------|
| Quantidade de pedidos | count de SalesOrder IDs únicos |
| Valor vendido | Σ `SalesOrder.totalNetValue` dos pedidos únicos |
| Quantidade de itens | Σ `SalesOrder.totalItems` |
| Ticket médio | valor vendido / quantidade de pedidos |
| Valor faturado | Σ NF válida agregada por `salesOrderId` |
| Saldo a faturar | max(0, vendido − NF válida) por pedido, depois soma |
| Margem | motor `salesMarginRulesEngine` (não recalcular) |

## Matriz de consumidores (resumo)

| Consumidor | Endpoint / serviço | Where / motor | Risco residual | Ação OP-02 |
|------------|-------------------|---------------|----------------|------------|
| Listagem Comercial | `GET /api/sales-orders` | `resolveSalesOrderListWhere` | Baixo | Já canônico |
| Cards listagem | mesmo where + summary | `buildSalesOrderListSummary` | Baixo | Já canônico |
| PDF Pedidos | `export-report.pdf` | `resolveSalesOrderListWhere` | Baixo | Já canônico |
| Excel Pedidos | `export-report.xlsx` | idem | Baixo | Já canônico |
| PDF Resultado Industrial | `industrial-result-report` | idem | Baixo | Já canônico |
| Excel margem interna | `export-internal.xlsx` | idem | Baixo | Já canônico |
| Resultado / Gestão | `/results`, `/management` | list/management where | Baixo | Já canônico |
| CRM Gestão/Vendedor | `loadCrmSalesOrderMetrics` | **presença adicionada** | Médio (eixo comercial próprio) | Migrado presença |
| Inteligência MP | `buildMaterialDemandSalesOrderWhere` | **presença + seller Nomus** | Médio (filtros MP) | Migrado |
| Funil / Presidencial | `loadSalesOrderEnrichedMetricsForIssueYear` | **list where year** | Baixo | Alinhado |
| Detalhe por ID | `GET /api/sales-orders/:id` | sem exclusão | — | HISTORICAL_AUDIT (ok) |
| Cliente 360 / reports | views próprias | parcial | Médio | Exceção: escopo cliente; presença futura |

## Causas das divergências históricas

1. Joins 1:N (itens/NF/CR) antes de agregar por `salesOrderId`
2. `where` ad-hoc sem `mergeSalesOrderOperationalPresenceWhere`
3. Seller via `responsible` legado vs `externalSellerId` Nomus
4. Cache/stampede e cálculos paralelos summary+rows (MP — tratado à parte)

## PD 02739

- `externalSalesOrderId = 2737`, `orderCode = PD 02739`, `MISSING_CONFIRMED`, R$ 117.000
- Com flag `NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED=true`: **fora** de consumidores OPERATIONAL
- Detalhe por ID / auditoria: **permanece acessível**

## Proteções

- Sem migration / schema / lifecycle Nomus / NF / CR / comissões pagas
- Motor somente leitura e consolidação
- Sem tabela materializada

## Exceções históricas justificadas

- **Comissões pagas / snapshots:** não reescrever histórico
- **Cliente 360:** população por cliente; métricas derivadas do pedido oficial quando possível
- **CRM portfolio SQL:** presença via SQL helper; predicates de carteira ainda paralelos ao motor NF-link (documentado)
