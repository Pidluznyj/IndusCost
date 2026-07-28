import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SalesOrderFlowListCard } from "@/src/lib/sales/salesOrderFlowList.js";
import {
  appendSalesOrderFlowColumnCards,
  applySalesOrderFlowColumnError,
  applySalesOrderFlowColumnPage,
  buildSalesOrderFlowIndicatorListFromColumns,
  createSalesOrderFlowColumnLoadingState,
  createSalesOrderFlowColumnStates,
  markSalesOrderFlowColumnLoadingMore,
  patchSalesOrderFlowKanbanCard,
  resolveSalesOrderFlowVisibleKanbanStages,
  SALES_ORDER_FLOW_COLUMN_PAGE_SIZE,
  SALES_ORDER_FLOW_KANBAN_STAGES,
} from "@/src/lib/salesOrderFlowKanbanPagination.js";
import { buildSalesOrderFlowQueryString } from "@/src/lib/salesOrderFlowClient.js";

function card(orderId: string, orderCode = orderId): SalesOrderFlowListCard {
  return {
    orderId,
    orderCode,
    customerName: null,
    sellerName: null,
    companyIssuer: null,
    stage: "IN_PRODUCTION",
    stageEnteredAt: null,
    daysInStage: 1,
    issueDate: null,
    promisedDeliveryAt: null,
    isOverdue: false,
    orderValue: 100,
    fulfilledValue: 0,
    activeResidualValue: 100,
    cutValue: 0,
    canceledValue: 0,
    totalItems: 1,
    activeItems: 1,
    completedItems: 0,
    pendingItems: 1,
    inconsistentItems: 0,
    canceledItems: 0,
    progressProductionOrder: 0,
    progressProduced: 0,
    progressDocumented: 0,
    progressInvoiced: 0,
    progressShipped: 0,
    nextAction: null,
    responsibleArea: null,
    bottleneckReason: null,
    stayReason: "Em produção",
    missingToLeave: "Aguardar conclusão",
    priority: "NORMAL",
    isBlocked: false,
    blockReason: null,
    inconsistencies: [],
    badges: [],
  };
}

describe("sales order flow kanban pagination (OP-68)", () => {
  it("resolve etapas visíveis sem carregar cancelado por padrão", () => {
    assert.deepEqual(
      resolveSalesOrderFlowVisibleKanbanStages([]),
      [...SALES_ORDER_FLOW_KANBAN_STAGES]
    );
    assert.deepEqual(
      resolveSalesOrderFlowVisibleKanbanStages(["IN_PRODUCTION", "CANCELED"]),
      ["IN_PRODUCTION", "CANCELED"]
    );
    assert.equal(
      resolveSalesOrderFlowVisibleKanbanStages([]).includes("CANCELED"),
      false
    );
  });

  it("serializa cursor oficial na query do cliente", () => {
    const qs = buildSalesOrderFlowQueryString({
      stages: ["IN_PRODUCTION"],
      limit: SALES_ORDER_FLOW_COLUMN_PAGE_SIZE,
      cursor: "cursor-abc",
    });
    assert.match(qs, /stages=IN_PRODUCTION/);
    assert.match(qs, /limit=20/);
    assert.match(qs, /cursor=cursor-abc/);

    const multi = buildSalesOrderFlowQueryString({
      stages: ["WAITING_RELEASE", "IN_PRODUCTION"],
      cursors: {
        WAITING_RELEASE: "c1",
        IN_PRODUCTION: "c2",
      },
    });
    assert.match(multi, /cursor\.WAITING_RELEASE=c1/);
    assert.match(multi, /cursor\.IN_PRODUCTION=c2/);
  });

  it("deduplica cards e preserva ordenação ao paginar", () => {
    const first = [card("a", "PV-1"), card("b", "PV-2")];
    const second = [card("b", "PV-2-dup"), card("c", "PV-3")];
    const merged = appendSalesOrderFlowColumnCards(first, second);
    assert.deepEqual(
      merged.map((row) => row.orderId),
      ["a", "b", "c"]
    );
    assert.equal(merged[1]?.orderCode, "PV-2");
  });

  it("aplica página inicial e append com hasMore/nextCursor/total", () => {
    const loading = createSalesOrderFlowColumnLoadingState("IN_PRODUCTION", 3);
    const page1 = applySalesOrderFlowColumnPage({
      state: loading,
      expectedGeneration: 3,
      mode: "replace",
      page: {
        stage: "IN_PRODUCTION",
        cards: [card("a"), card("b")],
        total: 5,
        hasMore: true,
        nextCursor: "next-1",
        totals: {
          overdueCount: 1,
          blockedCount: 0,
          inconsistentCount: 0,
          partiallyShippedCount: 1,
          withCutCount: 0,
        },
      },
    });
    assert.ok(page1);
    assert.equal(page1.status, "ready");
    assert.equal(page1.cards.length, 2);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextCursor, "next-1");
    assert.equal(page1.total, 5);

    const page2 = applySalesOrderFlowColumnPage({
      state: page1,
      expectedGeneration: 3,
      mode: "append",
      page: {
        stage: "IN_PRODUCTION",
        cards: [card("b"), card("c")],
        total: 5,
        hasMore: false,
        nextCursor: null,
        totals: page1.totals,
      },
    });
    assert.ok(page2);
    assert.deepEqual(
      page2.cards.map((row) => row.orderId),
      ["a", "b", "c"]
    );
    assert.equal(page2.hasMore, false);
    assert.equal(page2.nextCursor, null);
  });

  it("ignora resposta tardia após mudança de filtros (generation)", () => {
    const state = createSalesOrderFlowColumnLoadingState("WAITING_NFE", 1);
    const stale = applySalesOrderFlowColumnPage({
      state,
      expectedGeneration: 2,
      mode: "replace",
      page: {
        stage: "WAITING_NFE",
        cards: [card("x")],
        total: 1,
        hasMore: false,
        nextCursor: null,
        totals: {
          overdueCount: 0,
          blockedCount: 0,
          inconsistentCount: 0,
          partiallyShippedCount: 0,
          withCutCount: 0,
        },
      },
    });
    assert.equal(stale, null);

    const staleError = applySalesOrderFlowColumnError({
      state,
      expectedGeneration: 9,
      message: "falha",
    });
    assert.equal(staleError, null);
  });

  it("isola erro de coluna sem limpar cards já carregados no append", () => {
    const ready = applySalesOrderFlowColumnPage({
      state: createSalesOrderFlowColumnLoadingState("WAITING_RELEASE", 1),
      expectedGeneration: 1,
      mode: "replace",
      page: {
        stage: "WAITING_RELEASE",
        cards: [card("keep")],
        total: 2,
        hasMore: true,
        nextCursor: "n",
        totals: {
          overdueCount: 0,
          blockedCount: 0,
          inconsistentCount: 0,
          partiallyShippedCount: 0,
          withCutCount: 0,
        },
      },
    });
    assert.ok(ready);
    const loadingMore = markSalesOrderFlowColumnLoadingMore(ready, 1);
    assert.ok(loadingMore);
    assert.equal(loadingMore.loadingMore, true);

    const failedAppend = applySalesOrderFlowColumnError({
      state: loadingMore,
      expectedGeneration: 1,
      message: "Falha ao carregar mais",
      keepCards: true,
    });
    assert.ok(failedAppend);
    assert.equal(failedAppend.status, "ready");
    assert.equal(failedAppend.cards.length, 1);
    assert.equal(failedAppend.errorMessage, "Falha ao carregar mais");
    assert.equal(failedAppend.loadingMore, false);
  });

  it("monta lista de indicadores só com colunas solicitadas", () => {
    const columns = createSalesOrderFlowColumnStates(
      ["IN_PRODUCTION", "WAITING_NFE"],
      1
    );
    columns.IN_PRODUCTION = applySalesOrderFlowColumnPage({
      state: columns.IN_PRODUCTION!,
      expectedGeneration: 1,
      mode: "replace",
      page: {
        stage: "IN_PRODUCTION",
        cards: [card("a")],
        total: 4,
        hasMore: true,
        nextCursor: "c",
        totals: {
          overdueCount: 2,
          blockedCount: 1,
          inconsistentCount: 1,
          partiallyShippedCount: 0,
          withCutCount: 0,
        },
      },
    })!;

    const list = buildSalesOrderFlowIndicatorListFromColumns({
      stages: ["IN_PRODUCTION", "WAITING_NFE"],
      columns,
      inconsistenciesVisible: true,
    });
    assert.equal(list.columns.length, 2);
    assert.equal(list.columns[0]?.total, 4);
    assert.equal(list.columns[0]?.totals.overdueCount, 2);
    assert.equal(list.columns[1]?.total, 0);
  });

  it("atualiza prioridade/bloqueio do card sem mudar a coluna", () => {
    const columns = createSalesOrderFlowColumnStates(["IN_PRODUCTION"], 1);
    columns.IN_PRODUCTION = {
      ...columns.IN_PRODUCTION!,
      status: "ready",
      cards: [card("ord-1"), card("ord-2")],
      totals: {
        overdueCount: 0,
        blockedCount: 0,
        inconsistentCount: 0,
        partiallyShippedCount: 0,
        withCutCount: 0,
      },
    };
    const next = patchSalesOrderFlowKanbanCard(columns, "ord-1", {
      priority: "URGENT",
      isBlocked: true,
      blockReason: "Aguardando peça",
    });
    assert.equal(next.IN_PRODUCTION?.cards[0]?.priority, "URGENT");
    assert.equal(next.IN_PRODUCTION?.cards[0]?.isBlocked, true);
    assert.equal(next.IN_PRODUCTION?.cards[0]?.blockReason, "Aguardando peça");
    assert.equal(next.IN_PRODUCTION?.cards[0]?.stage, "IN_PRODUCTION");
    assert.equal(next.IN_PRODUCTION?.totals.blockedCount, 1);
    assert.equal(next.IN_PRODUCTION?.cards[1]?.priority, "NORMAL");
  });

  it("módulo usa carga por coluna com cursor, retry e cancelamento", () => {
    const mod = readFileSync(
      join(process.cwd(), "src/components/commercial/SalesOrderFlowModule.tsx"),
      "utf8"
    );
    assert.match(mod, /loadColumnPage/);
    assert.match(mod, /filterGenerationRef/);
    assert.match(mod, /abortAllColumnRequests/);
    assert.match(mod, /SALES_ORDER_FLOW_COLUMN_PAGE_SIZE/);
    assert.match(mod, /onLoadMore/);
    assert.match(mod, /onRetryColumn/);
    assert.match(mod, /mode: "append"/);
    assert.match(mod, /cursor: marked\.nextCursor/);
    assert.match(mod, /stages: \[input\.stage\]/);
  });
});
