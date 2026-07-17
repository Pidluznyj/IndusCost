import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSalesOrderFlowList } from "./salesOrderFlowList.server.js";
import type { SalesOrderFlowListDb } from "./salesOrderFlowList.server.js";
import { encodeSalesOrderFlowListCursor } from "./salesOrderFlowList.js";

function createDb() {
  const lightCalls: unknown[] = [];
  const fullCalls: unknown[] = [];
  const itemCalls: unknown[] = [];

  const snapshots = [
    {
      salesOrderId: "o1",
      currentStage: "WAITING_RELEASE",
      isOverdue: true,
      promisedDeliveryAt: new Date("2026-07-01T00:00:00Z"),
      inconsistenciesJson: [],
      badgesJson: ["OVERDUE"],
      inconsistentItems: 0,
      cutValue: 0,
      bottleneckSalesOrderItemId: "i1",
      nextAction: "Liberar",
      responsibleArea: "COMERCIAL",
      totalItems: 1,
      activeItems: 1,
      completedItems: 0,
      pendingItems: 1,
      canceledItems: 0,
      progressProductionOrder: 0,
      progressProduced: null,
      progressDocumented: 0,
      progressInvoiced: 0,
      progressShipped: 0,
      orderValue: 50,
      fulfilledValue: 0,
      activeResidualValue: 50,
      canceledValue: 0,
      salesOrder: {
        orderCode: "PD 1",
        issueDate: new Date("2026-06-01T00:00:00Z"),
        nomusSellerName: "Ana",
        responsible: null,
        companyIssuer: "Laz",
        Customer: { companyName: "Cliente A", tradeName: null },
        flowManagement: {
          priority: "NORMAL",
          isBlocked: false,
          blockReason: null,
        },
      },
    },
    {
      salesOrderId: "o2",
      currentStage: "WAITING_RELEASE",
      isOverdue: false,
      promisedDeliveryAt: new Date("2026-08-01T00:00:00Z"),
      inconsistenciesJson: [
        { code: "DUPLICATE_TRUTH_RISK", severity: "CRITICAL", detail: "x" },
      ],
      badgesJson: ["INCONSISTENT"],
      inconsistentItems: 1,
      cutValue: 0,
      bottleneckSalesOrderItemId: "i2",
      nextAction: "Liberar",
      responsibleArea: "COMERCIAL",
      totalItems: 1,
      activeItems: 1,
      completedItems: 0,
      pendingItems: 1,
      canceledItems: 0,
      progressProductionOrder: 0,
      progressProduced: null,
      progressDocumented: 0,
      progressInvoiced: 0,
      progressShipped: 0,
      orderValue: 80,
      fulfilledValue: 0,
      activeResidualValue: 80,
      canceledValue: 0,
      salesOrder: {
        orderCode: "PD 2",
        issueDate: new Date("2026-06-02T00:00:00Z"),
        nomusSellerName: "Ana",
        responsible: null,
        companyIssuer: "Laz",
        Customer: { companyName: "Cliente B", tradeName: null },
        flowManagement: {
          priority: "LOW",
          isBlocked: true,
          blockReason: "ok",
        },
      },
    },
    {
      salesOrderId: "o3",
      currentStage: "WAITING_RELEASE",
      isOverdue: false,
      promisedDeliveryAt: null,
      inconsistenciesJson: [],
      badgesJson: [],
      inconsistentItems: 0,
      cutValue: 10,
      bottleneckSalesOrderItemId: null,
      nextAction: "Liberar",
      responsibleArea: "COMERCIAL",
      totalItems: 1,
      activeItems: 1,
      completedItems: 0,
      pendingItems: 1,
      canceledItems: 0,
      progressProductionOrder: 0,
      progressProduced: null,
      progressDocumented: 0,
      progressInvoiced: 0,
      progressShipped: 0,
      orderValue: 20,
      fulfilledValue: 0,
      activeResidualValue: 10,
      canceledValue: 0,
      salesOrder: {
        orderCode: "PD 3",
        issueDate: new Date("2026-06-03T00:00:00Z"),
        nomusSellerName: "Ana",
        responsible: null,
        companyIssuer: "Laz",
        Customer: { companyName: "Cliente C", tradeName: null },
        flowManagement: {
          priority: "NORMAL",
          isBlocked: false,
          blockReason: null,
        },
      },
    },
  ];

  const db = {
    salesOrderFlowSnapshot: {
      findMany: async (args: {
        where: unknown;
        select?: unknown;
        take?: number;
      }) => {
        const whereJson = JSON.stringify(args.where ?? {});
        if (whereJson.includes('"salesOrderId"') && whereJson.includes('"in"')) {
          const idsMatch = whereJson.match(
            /"salesOrderId":\{"in":\[([^\]]*)\]/
          );
          const ids = idsMatch
            ? JSON.parse(`[${idsMatch[1]}]`) as string[]
            : [];
          fullCalls.push(ids);
          return snapshots.filter((s) => ids.includes(s.salesOrderId));
        }
        lightCalls.push(args.where);
        const stage =
          snapshots.find((s) => whereJson.includes(`"${s.currentStage}"`))
            ?.currentStage ?? "WAITING_RELEASE";
        // Prefer explicit stage from query string context — tests use WAITING_RELEASE.
        const forced = whereJson.includes("WAITING_RELEASE")
          ? "WAITING_RELEASE"
          : stage;
        return snapshots.filter((s) => s.currentStage === forced);
      },
    },
    salesOrderItemFlowSnapshot: {
      findMany: async (args: { where: { salesOrderItemId: { in: string[] } } }) => {
        itemCalls.push(args.where.salesOrderItemId.in);
        return [
          {
            salesOrderItemId: "i1",
            stageEnteredAt: new Date("2026-07-01T00:00:00Z"),
          },
          {
            salesOrderItemId: "i2",
            stageEnteredAt: new Date("2026-07-02T00:00:00Z"),
          },
        ];
      },
    },
  } as unknown as SalesOrderFlowListDb;

  return { db, lightCalls, fullCalls, itemCalls };
}

describe("salesOrderFlowList.server (OP-60)", () => {
  it("pagina cards sem carregar todos de uma vez e ordena com crítica primeiro", async () => {
    const { db, fullCalls } = createDb();
    const first = await loadSalesOrderFlowList(
      { stages: "WAITING_RELEASE", limit: "1" },
      {
        prisma: db,
        canViewValues: true,
        resolveSellerWhere: async () => null,
        now: () => new Date("2026-07-10T00:00:00Z"),
      }
    );

    assert.equal(first.columns.length, 1);
    const col = first.columns[0]!;
    assert.equal(col.total, 3);
    assert.equal(col.cards.length, 1);
    assert.equal(col.cards[0]!.orderId, "o2"); // crítica primeiro
    assert.equal(col.hasMore, true);
    assert.ok(col.nextCursor);
    assert.equal(col.totals.blockedCount, 1);
    assert.equal(col.totals.withCutCount, 1);
    assert.deepEqual(fullCalls[0], ["o2"]);

    const second = await loadSalesOrderFlowList(
      {
        stages: "WAITING_RELEASE",
        limit: "1",
        cursor: col.nextCursor!,
      },
      {
        prisma: db,
        canViewValues: true,
        resolveSellerWhere: async () => null,
      }
    );
    assert.equal(second.columns[0]!.cards[0]!.orderId, "o1"); // overdue next
  });

  it("aplica escopo de clientes no where leve", async () => {
    const { db, lightCalls } = createDb();
    await loadSalesOrderFlowList(
      { stages: "WAITING_RELEASE", limit: "5" },
      {
        prisma: db,
        scopeCustomerIds: ["c1"],
        resolveSellerWhere: async () => null,
      }
    );
    assert.match(JSON.stringify(lightCalls[0]), /"c1"/);
  });

  it("cursor de outra etapa é rejeitado", async () => {
    const { db } = createDb();
    await assert.rejects(
      () =>
        loadSalesOrderFlowList(
          {
            stages: "WAITING_RELEASE",
            limit: "1",
            cursor: encodeSalesOrderFlowListCursor({
              stage: "IN_PRODUCTION",
              afterOrderId: "o1",
            }),
          },
          {
            prisma: db,
            resolveSellerWhere: async () => null,
          }
        ),
      /Cursor inválido/
    );
  });
});
