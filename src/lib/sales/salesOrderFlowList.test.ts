import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareSalesOrderFlowSortRows,
  decodeSalesOrderFlowListCursor,
  encodeSalesOrderFlowListCursor,
  hasCriticalSalesOrderFlowInconsistency,
  mapSalesOrderFlowListCard,
  paginateSalesOrderFlowSortRows,
  parseSalesOrderFlowListQuery,
  SalesOrderFlowListQueryError,
  type SalesOrderFlowSortRow,
} from "./salesOrderFlowList.js";

function row(
  partial: Partial<SalesOrderFlowSortRow> & { salesOrderId: string }
): SalesOrderFlowSortRow {
  return {
    orderCode: partial.orderCode ?? partial.salesOrderId,
    issueDate: partial.issueDate ?? new Date("2026-01-01T00:00:00Z"),
    promisedDeliveryAt: partial.promisedDeliveryAt ?? null,
    isOverdue: partial.isOverdue ?? false,
    priority: partial.priority ?? "NORMAL",
    stageEnteredAt: partial.stageEnteredAt ?? null,
    hasCriticalInconsistency: partial.hasCriticalInconsistency ?? false,
    salesOrderId: partial.salesOrderId,
  };
}

describe("salesOrderFlowList (OP-60)", () => {
  it("parseia stages, limit e cursors por coluna", () => {
    const parsed = parseSalesOrderFlowListQuery({
      stages: "WAITING_RELEASE,IN_PRODUCTION",
      limit: "10",
      "cursor.WAITING_RELEASE": "abc",
      customerId: "c1",
    });
    assert.deepEqual(parsed.stages, ["WAITING_RELEASE", "IN_PRODUCTION"]);
    assert.equal(parsed.limit, 10);
    assert.equal(parsed.cursors.WAITING_RELEASE, "abc");
    assert.equal(parsed.filters.customerId, "c1");
  });

  it("rejeita etapa inválida", () => {
    assert.throws(
      () => parseSalesOrderFlowListQuery({ stages: "NOPE" }),
      SalesOrderFlowListQueryError
    );
  });

  it("ordenação determinística segue a precedência canônica", () => {
    const rows = [
      row({
        salesOrderId: "z",
        orderCode: "PD 3",
        priority: "LOW",
        isOverdue: false,
      }),
      row({
        salesOrderId: "a",
        orderCode: "PD 1",
        priority: "NORMAL",
        isOverdue: true,
      }),
      row({
        salesOrderId: "b",
        orderCode: "PD 2",
        priority: "URGENT",
        isOverdue: false,
        hasCriticalInconsistency: true,
      }),
      row({
        salesOrderId: "c",
        orderCode: "PD 0",
        priority: "HIGH",
        isOverdue: false,
        stageEnteredAt: new Date("2026-01-01T00:00:00Z"),
      }),
      row({
        salesOrderId: "d",
        orderCode: "PD 4",
        priority: "HIGH",
        isOverdue: false,
        stageEnteredAt: new Date("2026-02-01T00:00:00Z"),
      }),
    ];
    const sorted = [...rows].sort(compareSalesOrderFlowSortRows);
    assert.deepEqual(
      sorted.map((r) => r.salesOrderId),
      ["b", "a", "c", "d", "z"]
    );
  });

  it("paginação por cursor é estável e rejeita cursor inválido", () => {
    const rows = [
      row({ salesOrderId: "1", orderCode: "PD 1", isOverdue: true }),
      row({ salesOrderId: "2", orderCode: "PD 2", isOverdue: true }),
      row({ salesOrderId: "3", orderCode: "PD 3", isOverdue: false }),
      row({ salesOrderId: "4", orderCode: "PD 4", isOverdue: false }),
    ];
    const first = paginateSalesOrderFlowSortRows({
      rows,
      cursor: null,
      stage: "IN_PRODUCTION",
      limit: 2,
    });
    assert.equal(first.page.length, 2);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = paginateSalesOrderFlowSortRows({
      rows,
      cursor: first.nextCursor,
      stage: "IN_PRODUCTION",
      limit: 2,
    });
    assert.equal(second.page.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(
      [...first.page, ...second.page].map((r) => r.salesOrderId),
      ["1", "2", "3", "4"]
    );

    assert.throws(
      () =>
        decodeSalesOrderFlowListCursor(
          encodeSalesOrderFlowListCursor({
            stage: "WAITING_RELEASE",
            afterOrderId: "x",
          }),
          "IN_PRODUCTION"
        ),
      SalesOrderFlowListQueryError
    );
    assert.throws(
      () =>
        paginateSalesOrderFlowSortRows({
          rows,
          cursor: encodeSalesOrderFlowListCursor({
            stage: "IN_PRODUCTION",
            afterOrderId: "missing",
          }),
          stage: "IN_PRODUCTION",
          limit: 2,
        }),
      /fora do resultado/
    );
  });

  it("detecta inconsistência crítica e mascara valores no card", () => {
    assert.equal(
      hasCriticalSalesOrderFlowInconsistency([
        { code: "DUPLICATE_TRUTH_RISK", severity: "CRITICAL" },
      ]),
      true
    );
    const card = mapSalesOrderFlowListCard(
      {
        salesOrderId: "o1",
        currentStage: "WAITING_RELEASE",
        nextAction: "Liberar",
        responsibleArea: "COMERCIAL",
        totalItems: 2,
        activeItems: 2,
        completedItems: 0,
        pendingItems: 2,
        inconsistentItems: 1,
        canceledItems: 0,
        progressProductionOrder: 0,
        progressProduced: null,
        progressDocumented: 0,
        progressInvoiced: 0,
        progressShipped: 0,
        orderValue: 100,
        fulfilledValue: 0,
        activeResidualValue: 100,
        cutValue: 0,
        canceledValue: 0,
        promisedDeliveryAt: null,
        isOverdue: false,
        inconsistenciesJson: [],
        badgesJson: ["OVERDUE"],
        stageEnteredAt: new Date("2026-07-01T00:00:00Z"),
        salesOrder: {
          orderCode: "PD 1",
          issueDate: new Date("2026-06-01T00:00:00Z"),
          nomusSellerName: "Ana",
          responsible: "FATURAMENTO",
          companyIssuer: "Lazarios",
          Customer: { companyName: "Cliente", tradeName: null },
          flowManagement: {
            priority: "HIGH",
            isBlocked: true,
            blockReason: "crédito",
          },
        },
      },
      { canViewValues: false, now: new Date("2026-07-10T00:00:00Z") }
    );
    assert.equal(card.orderValue, null);
    assert.equal(card.activeResidualValue, null);
    assert.equal(card.isBlocked, true);
    assert.equal(card.priority, "HIGH");
    assert.equal(card.daysInStage, 9);
    assert.deepEqual(card.badges, ["OVERDUE"]);
  });
});
