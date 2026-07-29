/**
 * Regressão — coluna visual de produção no Kanban.
 * Garante que WAITING_PRODUCTION_ORDER chega à coluna "Em produção"
 * sem ser eliminado por filtro padrão / paginação / mapping.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderFlowKanbanColumnViews } from "@/src/components/commercial/SalesOrderFlowKanbanBoard.js";
import {
  SALES_ORDER_FLOW_STAGE_LABELS,
  getSalesOrderFlowStageLabel,
  resolveSalesOrderFlowOfficialStage,
} from "./sales/salesOrderFlowCatalog.js";
import {
  buildSalesOrderFlowSummarySnapshotWhere,
  parseSalesOrderFlowSummaryQuery,
} from "./sales/salesOrderFlowSummary.js";
import type { SalesOrderFlowListCard } from "./sales/salesOrderFlowList.js";
import {
  SALES_ORDER_FLOW_KANBAN_STAGES,
  applySalesOrderFlowColumnPage,
  createSalesOrderFlowColumnStates,
  resolveSalesOrderFlowVisibleKanbanStages,
} from "./salesOrderFlowKanbanPagination.js";
import {
  createDefaultSalesOrderFlowFilters,
  parseSalesOrderFlowFiltersFromSearchParams,
  salesOrderFlowFiltersToClientQuery,
} from "./salesOrderFlowUi.js";

const SAMPLE_CODES = [
  "PD 02050",
  "PD 02575",
  "PD 02739",
  "PD 02801",
  "PD 02826",
] as const;

function card(
  orderCode: string,
  stage: SalesOrderFlowListCard["stage"],
  issueDate: string
): SalesOrderFlowListCard {
  return {
    orderId: `id-${orderCode.replace(/\s+/g, "-")}`,
    orderCode,
    customerName: "Cliente",
    sellerName: null,
    companyIssuer: null,
    stage,
    stageEnteredAt: null,
    daysInStage: 1,
    issueDate,
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
    bottleneckReason: null,
    stayReason: "Em produção",
    missingToLeave: "Abrir ou vincular OP",
    nextAction: "Abrir OP",
    responsibleArea: "PCP_PRODUCAO",
    priority: "NORMAL",
    isBlocked: false,
    blockReason: null,
    inconsistencies: [],
    badges: [],
  };
}

describe("Kanban — coluna Em produção / WAITING_PRODUCTION_ORDER", () => {
  it("WAITING_PRODUCTION_ORDER mapeia para o label visual Em produção", () => {
    assert.equal(
      getSalesOrderFlowStageLabel("WAITING_PRODUCTION_ORDER"),
      "Em produção"
    );
    assert.equal(
      SALES_ORDER_FLOW_STAGE_LABELS.WAITING_PRODUCTION_ORDER,
      "Em produção"
    );
    assert.notEqual(
      SALES_ORDER_FLOW_STAGE_LABELS.IN_PRODUCTION,
      "Em produção"
    );
  });

  it("resolve oficial usa COALESCE(bottleneckStage, currentStage)", () => {
    assert.equal(
      resolveSalesOrderFlowOfficialStage({
        currentStage: "WAITING_RELEASE",
        bottleneckStage: "WAITING_PRODUCTION_ORDER",
      }),
      "WAITING_PRODUCTION_ORDER"
    );
    assert.equal(
      resolveSalesOrderFlowOfficialStage({
        currentStage: "WAITING_PRODUCTION_ORDER",
        bottleneckStage: null,
      }),
      "WAITING_PRODUCTION_ORDER"
    );
  });

  it("filtros padrão (URL vazia) não aplicam faixa de emissão que exclui produção", () => {
    const now = new Date(2026, 6, 29);
    const defaults = createDefaultSalesOrderFlowFilters(now);
    assert.equal(defaults.year, "");
    assert.equal(defaults.month, "");
    assert.equal(defaults.issueFrom, "");
    assert.equal(defaults.issueTo, "");

    const fromUrl = parseSalesOrderFlowFiltersFromSearchParams(
      new URLSearchParams(""),
      now
    );
    assert.equal(fromUrl.issueFrom, "");
    assert.equal(fromUrl.issueTo, "");

    const clientQuery = salesOrderFlowFiltersToClientQuery(fromUrl);
    assert.equal(clientQuery.issueFrom, null);
    assert.equal(clientQuery.issueTo, null);

    const where = buildSalesOrderFlowSummarySnapshotWhere({
      filters: parseSalesOrderFlowSummaryQuery(
        clientQuery as Record<string, unknown>
      ),
      sellerWhere: null,
      scopeCustomerIds: null,
    });
    assert.equal(
      JSON.stringify(where).includes("issueDate"),
      false,
      "where não deve restringir issueDate nos filtros padrão"
    );
  });

  it("agrupador do Kanban popula WAITING_PRODUCTION_ORDER com cards oficiais", () => {
    const stages = resolveSalesOrderFlowVisibleKanbanStages([]);
    assert.ok(stages.includes("WAITING_PRODUCTION_ORDER"));
    assert.ok(stages.includes("IN_PRODUCTION"));

    const generation = 1;
    let columns = createSalesOrderFlowColumnStates(stages, generation);

    const productionCards = SAMPLE_CODES.map((code) =>
      card(code, "WAITING_PRODUCTION_ORDER", "2025-06-01")
    );
    const fixturePages: Array<{
      stage: (typeof SALES_ORDER_FLOW_KANBAN_STAGES)[number];
      cards: SalesOrderFlowListCard[];
    }> = [
      {
        stage: "WAITING_RELEASE",
        cards: [card("PD 09999", "WAITING_RELEASE", "2026-01-01")],
      },
      {
        stage: "WAITING_PRODUCTION_ORDER",
        cards: productionCards,
      },
      {
        stage: "WAITING_OUTPUT_DOCUMENT",
        cards: [card("PD 08888", "WAITING_OUTPUT_DOCUMENT", "2026-02-01")],
      },
      {
        stage: "SHIPPED_COMPLETED",
        cards: [card("PD 07777", "SHIPPED_COMPLETED", "2026-03-01")],
      },
    ];

    for (const page of fixturePages) {
      const state = columns[page.stage]!;
      const next = applySalesOrderFlowColumnPage({
        state,
        expectedGeneration: generation,
        mode: "replace",
        page: {
          stage: page.stage,
          cards: page.cards,
          total: page.cards.length,
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
      assert.ok(next);
      columns = { ...columns, [page.stage]: next! };
    }

    const views = buildSalesOrderFlowKanbanColumnViews({
      stages,
      columns,
      indicators: stages.map((stage) => ({
        stage,
        label: SALES_ORDER_FLOW_STAGE_LABELS[stage],
        orderCount: columns[stage]?.total ?? 0,
        orderValue: 0,
        activeResidualValue: 0,
        overdueCount: 0,
        blockedCount: 0,
        inconsistentCount: 0,
        partiallyShippedCount: 0,
        withCutCount: 0,
      })),
    });
    const productionCol = views.find(
      (c) => c.stage === "WAITING_PRODUCTION_ORDER"
    );
    assert.ok(productionCol);
    assert.equal(productionCol!.label, "Em produção");
    assert.ok(productionCol!.cards.length >= 5);
    for (const code of SAMPLE_CODES) {
      assert.ok(
        productionCol!.cards.some((c) => c.orderCode === code),
        `${code} deve aparecer na coluna Em produção`
      );
    }
  });

  it("paginação é por coluna — não corta WAITING_PRODUCTION_ORDER antes do agrupamento", () => {
    const stages = resolveSalesOrderFlowVisibleKanbanStages([]);
    assert.deepEqual(
      stages.filter((s) => s === "WAITING_PRODUCTION_ORDER"),
      ["WAITING_PRODUCTION_ORDER"]
    );
    assert.ok(SALES_ORDER_FLOW_KANBAN_STAGES.includes("WAITING_PRODUCTION_ORDER"));
  });

  it("filtros padrão não excluem SENT_TO_NOMUS nem status legado do pedido", () => {
    const where = buildSalesOrderFlowSummarySnapshotWhere({
      filters: parseSalesOrderFlowSummaryQuery({}),
      sellerWhere: null,
      scopeCustomerIds: null,
    });
    const serialized = JSON.stringify(where);
    assert.equal(serialized.includes("SENT_TO_NOMUS"), false);
    assert.equal(serialized.includes('"status"'), false);
  });
});
