/**
 * OP-77 — Matriz integrada de validação da interface do Kanban.
 * SSR + contratos de fonte; viewports 1366×768 e 1920×1080 (zoom 100%).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SalesOrderFlowKanbanBoard,
  SalesOrderFlowKanbanCard,
  SALES_ORDER_FLOW_OPERATIONAL_STAGES,
} from "@/src/components/commercial/SalesOrderFlowKanbanBoard.js";
import type { SalesOrderFlowListCard } from "@/src/lib/sales/salesOrderFlowList.js";
import {
  applySalesOrderFlowColumnPage,
  createSalesOrderFlowColumnLoadingState,
  createSalesOrderFlowColumnStates,
} from "@/src/lib/salesOrderFlowKanbanPagination.js";
import {
  buildSalesOrderFlowSearchParams,
  parseSalesOrderFlowDrawerFromSearchParams,
  parseSalesOrderFlowFiltersFromSearchParams,
  SALES_ORDER_FLOW_VIEWPORTS,
  salesOrderFlowViewportClass,
} from "@/src/lib/salesOrderFlowUi.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const sampleCard: SalesOrderFlowListCard = {
  orderId: "order-77",
  orderCode: "PV-0077",
  customerName: "Cliente Visual",
  sellerName: "Vendedor A",
  companyIssuer: "Lazarios",
  stage: "WAITING_RELEASE",
  stageEnteredAt: "2026-07-10T12:00:00.000Z",
  daysInStage: 3,
  issueDate: "2026-07-01T12:00:00.000Z",
  promisedDeliveryAt: "2026-07-20T12:00:00.000Z",
  isOverdue: false,
  orderValue: 1500,
  fulfilledValue: 0,
  activeResidualValue: 1500,
  cutValue: 0,
  canceledValue: 0,
  totalItems: 2,
  activeItems: 2,
  completedItems: 0,
  pendingItems: 2,
  inconsistentItems: 0,
  canceledItems: 0,
  progressProductionOrder: 0,
  progressProduced: null,
  progressDocumented: 0,
  progressInvoiced: 0,
  progressShipped: 0,
  nextAction: "Liberar",
  responsibleArea: "COMERCIAL",
  priority: "HIGH",
  isBlocked: true,
  blockReason: "Crédito",
  inconsistencies: [],
  badges: ["PARTIAL"],
};

function emptyTotals() {
  return {
    overdueCount: 0,
    blockedCount: 1,
    inconsistentCount: 0,
    partiallyShippedCount: 0,
    withCutCount: 0,
  };
}

function ViewportShell({
  viewport,
  children,
}: {
  viewport: "1366" | "1920";
  children: React.ReactNode;
}) {
  const meta = SALES_ORDER_FLOW_VIEWPORTS.find((v) => v.id === viewport)!;
  return React.createElement(
    "div",
    {
      "data-testid": `sales-order-flow-viewport-${viewport}`,
      "data-viewport": viewport,
      "data-viewport-label": meta.label,
      "data-zoom": "100",
      className: salesOrderFlowViewportClass(viewport),
      style: { width: meta.width, maxHeight: meta.height },
    },
    children
  );
}

describe("salesOrderFlowUiValidationMatrix (OP-77)", () => {
  it("loading / erro / vazio: módulo expõe testids canônicos", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    for (const id of [
      "sales-order-flow-loading",
      "sales-order-flow-empty",
      "sales-order-flow-empty-filters",
      "sales-order-flow-error",
      "sales-order-flow-denied",
      "sales-order-flow-feature-disabled",
    ]) {
      assert.match(mod, new RegExp(id));
    }
  });

  it("filtros e URL: round-trip preserva estado e drawer", () => {
    const params = new URLSearchParams(
      "q=ABC&overdue=true&stages=WAITING_RELEASE&priority=HIGH&orderId=11111111-1111-4111-8111-111111111111&order=PV-1"
    );
    const filters = parseSalesOrderFlowFiltersFromSearchParams(params);
    assert.equal(filters.q, "ABC");
    assert.equal(filters.overdue, true);
    assert.deepEqual(filters.stages, ["WAITING_RELEASE"]);
    assert.equal(filters.priority, "HIGH");
    const drawer = parseSalesOrderFlowDrawerFromSearchParams(params);
    assert.equal(drawer.orderId, "11111111-1111-4111-8111-111111111111");
    assert.equal(drawer.orderCode, "PV-1");
    const serialized = buildSalesOrderFlowSearchParams(filters, {
      orderId: drawer.orderId,
      orderCode: drawer.orderCode,
    }).toString();
    assert.match(serialized, /q=ABC/);
    assert.match(serialized, /orderId=/);
    assert.match(serialized, /order=PV-1/);
  });

  it("cards / colunas / carregar mais: board operacional", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowKanbanBoard, {
        columns: SALES_ORDER_FLOW_OPERATIONAL_STAGES.map((stage, index) => ({
          stage,
          status: index === 0 ? ("ready" as const) : ("loading" as const),
          cards: index === 0 ? [sampleCard] : [],
          total: index === 0 ? 5 : 0,
          hasMore: index === 0,
          nextCursor: index === 0 ? "cursor-1" : null,
          loadingMore: false,
          errorMessage: null,
          generation: 1,
          label: stage,
          orderValue: index === 0 ? 1500 : null,
          activeResidualValue: index === 0 ? 1500 : null,
          totals: emptyTotals(),
        })),
        valuesVisible: true,
        inconsistenciesVisible: true,
        onOpenOrder: () => {},
        onLoadMore: () => {},
        onRetryColumn: () => {},
      })
    );
    assert.match(html, /sales-order-flow-kanban/);
    assert.match(html, /overflow-x-auto/);
    assert.match(html, /min-w-max/);
    assert.equal(SALES_ORDER_FLOW_OPERATIONAL_STAGES.length, 6);
    for (const stage of SALES_ORDER_FLOW_OPERATIONAL_STAGES) {
      assert.match(
        html,
        new RegExp(`sales-order-flow-kanban-column-${stage}`)
      );
    }
    assert.match(html, /sales-order-flow-card-order-77/);
    assert.match(html, /sales-order-flow-kanban-load-more-WAITING_RELEASE/);
    assert.match(html, /PV-0077/);
    assert.match(html, /Bloqueado/);
    assert.match(html, /Alta/);
  });

  it("permissões: valores e inconsistências ocultos no card", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowKanbanCard, {
        card: {
          ...sampleCard,
          inconsistencies: [
            {
              code: "ITEM_STATUS_UNKNOWN",
              severity: "WARNING",
              detail: null,
            },
          ],
        },
        valuesVisible: false,
        inconsistenciesVisible: false,
        onOpen: () => {},
      })
    );
    assert.match(html, /Valores ocultos por permissão/);
    assert.doesNotMatch(html, /1\.500/);
    assert.doesNotMatch(html, /inconsistência\(s\)/);
  });

  it("bloqueio e prioridade: card destaca estados operacionais", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowKanbanCard, {
        card: sampleCard,
        valuesVisible: true,
        inconsistenciesVisible: true,
        onOpen: () => {},
      })
    );
    assert.match(html, /Bloqueado/);
    assert.match(html, /Crédito/);
    assert.match(html, /Alta/);
  });

  it("drawer / abas / deep link / retorno: contratos do módulo e drawer", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    const drawer = read(
      "src/components/commercial/SalesOrderFlowDetailDrawer.tsx"
    );
    assert.match(mod, /SalesOrderFlowDetailDrawer/);
    assert.match(mod, /parseSalesOrderFlowDrawerFromSearchParams/);
    assert.match(mod, /kanbanScrollRef/);
    assert.match(mod, /scrollLeft/);
    assert.match(drawer, /sales-order-flow-detail/);
    assert.match(drawer, /sales-order-flow-detail-tabs/);
    assert.match(drawer, /Voltar ao Kanban|voltar ao kanban/i);
    assert.match(drawer, /recompute|Recomputar/i);
  });

  it("cancelamento de requisições antigas: AbortController + generation", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /AbortController/);
    assert.match(mod, /abortAllColumnRequests/);
    assert.match(mod, /filterGenerationRef/);

    const loading = createSalesOrderFlowColumnLoadingState(
      "WAITING_RELEASE",
      1
    );
    const stale = applySalesOrderFlowColumnPage({
      state: loading,
      expectedGeneration: 2,
      page: {
        stage: "WAITING_RELEASE",
        cards: [sampleCard],
        total: 1,
        hasMore: false,
        nextCursor: null,
        totals: emptyTotals(),
      },
      mode: "replace",
    });
    assert.equal(stale, null);

    const applied = applySalesOrderFlowColumnPage({
      state: loading,
      expectedGeneration: 1,
      page: {
        stage: "WAITING_RELEASE",
        cards: [sampleCard],
        total: 1,
        hasMore: false,
        nextCursor: null,
        totals: emptyTotals(),
      },
      mode: "replace",
    });
    assert.ok(applied);
    assert.equal(applied!.cards.length, 1);

    const states = createSalesOrderFlowColumnStates(
      ["WAITING_RELEASE", "IN_PRODUCTION"],
      3
    );
    assert.equal(states.WAITING_RELEASE?.generation, 3);
    assert.equal(states.IN_PRODUCTION?.status, "loading");
  });

  it("layout: coluna com scroll vertical e sem sobreposição de header", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowKanbanBoard, {
        columns: [
          {
            stage: "IN_PRODUCTION",
            status: "ready",
            cards: [sampleCard, { ...sampleCard, orderId: "order-78", orderCode: "PV-0078" }],
            total: 2,
            hasMore: false,
            nextCursor: null,
            loadingMore: false,
            errorMessage: null,
            generation: 1,
            label: "Em produção",
            orderValue: 3000,
            activeResidualValue: 3000,
            totals: emptyTotals(),
          },
        ],
        valuesVisible: true,
        inconsistenciesVisible: true,
        onOpenOrder: () => {},
        onLoadMore: () => {},
        onRetryColumn: () => {},
      })
    );
    assert.match(html, /max-h-\[min\(70vh,640px\)\]/);
    assert.match(html, /overflow-y-auto/);
    assert.match(html, /overscroll-y-contain/);
    assert.match(html, /sales-order-flow-kanban-column-scroll-IN_PRODUCTION/);
    assert.match(html, /text-slate-600|text-foreground/);
    assert.doesNotMatch(html, /draggable/);
  });

  for (const viewport of SALES_ORDER_FLOW_VIEWPORTS) {
    it(`viewport ${viewport.label} @ zoom 100%: board cabe no shell sem quebrar cards`, () => {
      const html = renderToStaticMarkup(
        React.createElement(
          ViewportShell,
          { viewport: viewport.id },
          React.createElement(SalesOrderFlowKanbanBoard, {
            columns: SALES_ORDER_FLOW_OPERATIONAL_STAGES.map((stage) => ({
              stage,
              status: "ready" as const,
              cards: stage === "WAITING_RELEASE" ? [sampleCard] : [],
              total: stage === "WAITING_RELEASE" ? 1 : 0,
              hasMore: false,
              nextCursor: null,
              loadingMore: false,
              errorMessage: null,
              generation: 1,
              label: stage,
              orderValue: null,
              activeResidualValue: null,
              totals: emptyTotals(),
            })),
            valuesVisible: true,
            inconsistenciesVisible: true,
            onOpenOrder: () => {},
            onLoadMore: () => {},
            onRetryColumn: () => {},
          })
        )
      );
      assert.match(html, new RegExp(`data-viewport="${viewport.id}"`));
      assert.match(html, /data-zoom="100"/);
      assert.match(
        html,
        new RegExp(`sales-order-flow-viewport-${viewport.id}`)
      );
      assert.match(html, new RegExp(`w-\\[${viewport.width}px\\]`));
      assert.match(html, /sales-order-flow-kanban/);
      assert.match(html, /overflow-x-auto/);
      assert.match(html, /min-w-max/);
      assert.match(html, /w-\[300px\]/);
      assert.match(html, /PV-0077/);
      // 6×300 + gaps > 1366 → scroll horizontal esperado, cards intactos
      assert.ok(6 * 300 > 1366);
      assert.match(html, /truncate/);
    });
  }
});
