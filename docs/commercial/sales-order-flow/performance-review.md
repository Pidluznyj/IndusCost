# OP-75 — Revisão de desempenho do Kanban de Pedidos

**Data:** 2026-07-17  
**Escopo:** acesso a dados do Fluxo de Pedidos (resumo, listagem, evidências, recompute em lote, detalhe, eventos).  
**Fora de escopo:** medição de latência em produção, cache Redis, redesenho da UI, mudança da máquina de estados.

> **Aviso:** as metas de latência abaixo são **referência de produto**, não afirmativas de desempenho real. Não há medição no servidor de produção neste documento.

## Metas de referência (latência)

| Superfície | Meta |
|------------|------|
| Resumo | ≤ 1 s |
| Carga inicial do Kanban | ≤ 2 s |
| Página adicional de coluna | ≤ 1 s |
| Detalhe | ≤ 2 s |

Constantes: `src/lib/sales/salesOrderFlowPerformance.ts` (`SALES_ORDER_FLOW_LATENCY_TARGETS_MS`).

## Checklist YAGNI / reutilização

| Pergunta | Decisão |
|----------|---------|
| Kanban lê snapshots ou evidência ao vivo? | **Snapshots** (já existente). Não reescrever para live evidence. |
| Existe middleware de query count? | **Não.** Testes usam contadores em mocks (padrão `productionOrdersList.test.ts`). |
| Vale denormalizar sort keys / SQL cursor agora? | **Não**, sem EXPLAIN em produção. Manter índice leve + sort em memória. |
| Vale GIN em `badgesJson` / novo índice em bottleneck? | **Não** sem evidência de EXPLAIN. Índices atuais de stage/overdue bastam para o filtro. |
| Recompute no GET do Kanban? | **Não** — já não ocorre. |

## Orçamentos de query (hoje)

| Endpoint / caminho | Orçamento Prisma | Notas |
|--------------------|------------------|--------|
| Resumo | **8** | 1× `groupBy` + 6× `count` + 1× `aggregate` em paralelo |
| Listagem / coluna | **≤ 3** por stage | light index → bottleneck items → cards da página |
| Listagem (7 stages) | ~21 | stages em paralelo; sem N+1 por card |
| Evidência (lote) | **≤ 9** steps | pipeline fixo; sem `rawJson` |
| Detalhe | 1 scope + evidência (+ flags) + 3 repo | fiscal/OP omitíveis por permissão |
| Eventos | 1 scope + count + page | `select` explícito (OP-75) |
| Rebuild / post-sync | **1× evidence batch** + N recomputes | packs injetados; fingerprint evita rewrite |

## Achados por superfície

### Resumo

- Já batch-safe: agregações em `SalesOrderFlowSnapshot`, filtro via `items.some` (sem fan-out de linhas).
- Seller text pode acrescentar resolução de identidade (fora do orçamento 8).
- **Ação OP-75:** teste de query count = 8; sem mudança estrutural.

### Listagem por coluna

- Sem N+1 por card; joins 1:1 (`salesOrder`, `flowManagement`).
- Hotspot residual: até 5k linhas leves/coluna para sort em memória (`SALES_ORDER_FLOW_LIST_SORT_INDEX_CAP`).
- Full select só para IDs da página (`limit` ≤ 50).
- **Ação OP-75:** teste ≤ 3 finds/stage; full só page IDs. Sem denormalização.

### Carregador de evidências

- Pipeline em lote já existia; **sem `rawJson`**.
- Rebuild/post-sync chamavam evidência **por pedido** (N × pipeline).
- **Ação OP-75:**
  - `includeFiscalEvidence` / `includeProductionEvidence` (default `true` para recompute).
  - Detalhe omite NF/stock ou OP quando sem permissão.
  - Rebuild e post-sync: `loadSalesOrderFlowEvidenceBatch` **uma vez** por lote + `evidencePack` no recompute.

### Recomputação em lote

- Fingerprint match já evita writes repetidos.
- **Ação OP-75:** evidência em lote no rebuild e no pós-sync Nomus.
- Concorrência limitada (p.ex. 3–5) deixada como follow-up se medição exigir.

### Detalhe e eventos

- Detalhe reutiliza evidência + repositories; sem Nomus HTTP.
- Eventos: `select` das colunas usadas (inclui `payloadJson` sanitizado).
- Snapshots de detalhe ainda leem linha completa — campos são usados no DTO; select estreito seria ganho marginal (YAGNI até perfilar).

### Índices (`schema.prisma`)

- Stage / overdue / composites e `[salesOrderId, occurredAt desc]` em eventos já cobrem filtros principais.
- Sem migration nesta OP.

## Otimizações aplicadas (OP-75)

1. Flags de superfície no loader de evidências + detalhe por permissão.
2. `select` em `findSalesOrderFlowEventsByOrderId`.
3. Evidência em lote no rebuild e no recompute pós-sync.
4. Constantes de orçamento/metas + testes de query count / batch inject.
5. Este documento.

## Como medir no servidor (quando houver janela)

1. Habilitar log Prisma `query` (ou APM) em staging com volume realista.
2. Cronometrar: `GET .../summary`, `GET .../list` (1ª página, 7 stages), cursor de coluna, `GET .../detail`.
3. Comparar com metas da tabela; se estourar, priorizar: denormalizar sort keys → SQL cursor; só então GIN/índice bottleneck.
4. Não usar estes números de staging como “garantia de produção” sem repetir a medição lá.

## Testes

- `salesOrderFlowPerformance.test.ts` — orçamentos e metas.
- `salesOrderFlowSummary.server.test.ts` — 8 ops.
- `salesOrderFlowList.server.test.ts` — 3 finds/coluna.
- `salesOrderFlowEvidence.test.ts` — pipeline + flags.
- `salesOrderFlowRebuild.test.ts` / `salesOrderFlowRecomputeAfterNomusSync.test.ts` — um batch load + `evidencePack`.
