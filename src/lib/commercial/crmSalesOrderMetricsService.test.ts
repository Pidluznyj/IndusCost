import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCrmMetricsByCommercialOwnerBuckets,
  buildCrmSalesOrderMetrics,
  CRM_NO_COMMERCIAL_OWNER_BUCKET,
  CRM_SALES_ORDER_METRICS_SOURCE,
  filterCrmSalesOrderMetricsUniverse,
  type CrmMetricsOrderInput,
} from "./crmSalesOrderMetricsService.ts";
import {
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
  resolveOfficialScopedOrderMetrics,
} from "@/src/lib/salesOrderRulesAdapter.ts";
import { isCancelledSalesOrderStatus } from "@/src/lib/salesOrderDashboardRules.ts";

function order(partial: Partial<CrmMetricsOrderInput> & Pick<CrmMetricsOrderInput, "id" | "orderCode">): CrmMetricsOrderInput {
  return {
    status: "SENT_TO_NOMUS",
    issueDate: new Date("2026-07-01T12:00:00"),
    totalNetValue: 1000,
    totalItems: 1,
    customerId: "cust-1",
    nomusSellerName: null,
    externalSellerId: null,
    responsible: null,
    nomusRawResponse: {},
    items: [],
    Customer: {
      companyName: "Cliente Alpha",
      tradeName: "Alpha",
      CrmCustomerCommercialOwner: {
        sellerCanonicalName: "GISLENE LIMA",
        sellerResponsibleName: "GISLENE LIMA",
        sellerIdentityKey: "gislene lima",
        sellerExternalId: 464,
        isActive: true,
      },
    },
    ...partial,
  };
}

describe("crmSalesOrderMetricsService", () => {
  it("1) métricas por responsável comercial", () => {
    const orders = [
      order({
        id: "o1",
        orderCode: "1",
        totalNetValue: 5000,
        nomusSellerName: "OUTRO VENDEDOR",
        externalSellerId: 999,
      }),
      order({
        id: "o2",
        orderCode: "2",
        customerId: "cust-2",
        totalNetValue: 2000,
        Customer: {
          companyName: "Beta",
          CrmCustomerCommercialOwner: {
            sellerCanonicalName: "JOSEANE",
            sellerIdentityKey: "joseane",
            sellerExternalId: 100,
            isActive: true,
          },
        },
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.totalOrderValue, 5000);
    assert.equal(metrics.debug.portfolioAxis, "commercial_owner");
  });

  it("2) métricas por período (issueDate)", () => {
    const orders = [
      order({ id: "in", orderCode: "in", issueDate: new Date("2026-07-05"), totalNetValue: 100 }),
      order({ id: "out", orderCode: "out", issueDate: new Date("2026-05-01"), totalNetValue: 9999 }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { from: "2026-07-01", to: "2026-07-31" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.totalOrderValue, 100);
  });

  it("3) pedido sem vendedor Nomus não some do CRM se cliente tem responsável", () => {
    const orders = [
      order({
        id: "no-seller",
        orderCode: "NS",
        totalNetValue: 3500,
        nomusSellerName: null,
        externalSellerId: null,
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { responsibleCommercialName: "Gislene Lima" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.ordersWithoutNomusSeller, 1);
    assert.equal(metrics.totalOrderValue, 3500);
  });

  it("4) responsável ≠ vendedor do pedido: pedido fica na carteira; service não toca comissão", () => {
    const serviceSrc = readFileSync(
      join(process.cwd(), "src/lib/commercial/crmSalesOrderMetricsService.ts"),
      "utf8"
    );
    assert.equal(/commission[A-Z]|commissionReleases|prisma\.commission/i.test(serviceSrc), false);
    assert.equal(/prisma\.proposal/i.test(serviceSrc), false);

    const orders = [
      order({
        id: "divergent",
        orderCode: "D1",
        totalNetValue: 8000,
        nomusSellerName: "RODRIGO SILVA",
        externalSellerId: 777,
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.ordersWithResponsibleDifferentFromOrderSeller, 1);
    const auditOnly = filterCrmSalesOrderMetricsUniverse(orders, {
      sellerName: "RODRIGO SILVA",
    });
    assert.equal(auditOnly.length, 1);
    assert.equal(auditOnly[0]!.externalSellerId, 777);
  });

  it("5) propostas não são usadas", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/commercial/crmSalesOrderMetricsService.ts"),
      "utf8"
    );
    assert.equal(/prisma\.proposal|"Proposal"|from \"Proposal\"/i.test(src), false);
    assert.match(src, /SalesOrder/);
  });

  it("6) produto líder vem de SalesOrderItem", () => {
    const orders = [
      order({
        id: "o1",
        orderCode: "1",
        items: [
          {
            productId: "p-motor",
            productNameSnapshot: "Motor 3CV",
            skuSnapshot: "MOT-3",
            quantity: 2,
            totalNetValue: 4000,
          },
          {
            productId: "p-anel",
            productNameSnapshot: "Anel",
            skuSnapshot: "AN-1",
            quantity: 10,
            totalNetValue: 500,
          },
        ],
      }),
      order({
        id: "o2",
        orderCode: "2",
        items: [
          {
            productId: "p-motor",
            productNameSnapshot: "Motor 3CV",
            skuSnapshot: "MOT-3",
            quantity: 1,
            totalNetValue: 2000,
          },
        ],
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({ orders });
    assert.ok(metrics.leadingProduct);
    assert.equal(metrics.leadingProduct!.productId, "p-motor");
    assert.equal(metrics.leadingProduct!.productName, "Motor 3CV");
    assert.equal(metrics.leadingProduct!.revenue, 6000);
    assert.ok(metrics.topCommercialOwners.length >= 1);
    assert.equal(metrics.topCommercialOwners[0]!.label, "GISLENE LIMA");
  });

  it("7) cancelados seguem regra oficial (status CANCELLED)", () => {
    assert.equal(isCancelledSalesOrderStatus("CANCELLED"), true);
    assert.equal(isCancelledSalesOrderStatus("SENT_TO_NOMUS"), false);
    const orders = [
      order({ id: "ok", orderCode: "OK", totalNetValue: 1000 }),
      order({
        id: "c",
        orderCode: "C",
        status: "CANCELLED",
        totalNetValue: 5000,
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { includeCancelled: true },
    });
    assert.equal(metrics.canceledOrders, 1);
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.totalOrderValue, 1000);

    const excl = buildCrmSalesOrderMetrics({
      orders,
      filters: { includeCancelled: false },
    });
    assert.equal(excl.canceledOrders, 0);
    assert.equal(excl.debug.universeOrderCount, 1);
  });

  it('8) cliente sem responsável cai no bucket "Sem responsável comercial"', () => {
    const orders = [
      order({
        id: "orphan",
        orderCode: "OR",
        customerId: "cust-x",
        totalNetValue: 1500,
        Customer: {
          companyName: "Sem Dono LTDA",
          CrmCustomerCommercialOwner: null,
        },
      }),
      order({
        id: "owned",
        orderCode: "OW",
        totalNetValue: 500,
      }),
    ];
    const buckets = buildCrmMetricsByCommercialOwnerBuckets(orders);
    const orphan = buckets.find((b) => b.bucket === CRM_NO_COMMERCIAL_OWNER_BUCKET);
    assert.ok(orphan);
    assert.equal(orphan!.metrics.totalOrders, 1);
    assert.equal(orphan!.metrics.totalOrderValue, 1500);

    const metrics = buildCrmSalesOrderMetrics({ orders });
    assert.equal(metrics.customersWithoutCommercialResponsible, 1);
  });

  it("9) números batem com resolveOfficialScopedOrderMetrics no mesmo universo", () => {
    const orders = [
      order({ id: "a", orderCode: "A", totalNetValue: 2000 }),
      order({ id: "b", orderCode: "B", totalNetValue: 3000 }),
      order({
        id: "c",
        orderCode: "C",
        status: "CANCELLED",
        totalNetValue: 9000,
      }),
    ];
    const metrics = buildCrmSalesOrderMetrics({
      orders,
      filters: { from: "2026-06-01", to: "2026-07-31" },
    });
    const active = orders.filter((o) => !isCancelledSalesOrderStatus(o.status));
    const rulesOrders = active.map((o) =>
      mapPrismaOrderToSalesOrderRulesInput({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        customerId: o.customerId,
        issueDate: o.issueDate,
        totalNetValue: o.totalNetValue,
        totalItems: 1,
        nomusSellerName: o.nomusSellerName,
        externalSellerId: o.externalSellerId,
        responsible: o.responsible,
        nomusRawResponse: {},
        items: [],
      })
    );
    const official = resolveOfficialScopedOrderMetrics({
      orders: rulesOrders,
      referenceDate: new Date("2026-07-15"),
      managementFilters: {
        allYears: true,
        startDate: new Date("2026-06-01T00:00:00"),
        endDate: new Date("2026-07-31T23:59:59.999"),
      },
    });
    assert.equal(active.length, 2);
    assert.equal(metrics.totalOrders, 2);
    assert.equal(metrics.totalOrderValue, official.soldAmount);
    assert.equal(metrics.averageTicket, official.averageTicket);
    assert.equal(metrics.openPortfolioOrders, official.openPortfolioCount);
    assert.equal(metrics.canceledOrders, 1);
    assert.equal(metrics.totalOrderValue, 5000);
    assert.equal(metrics.debug.metricsSource, OFFICIAL_SO_RULES_SOURCE);
    assert.equal(metrics.debug.sourceInfo, CRM_SALES_ORDER_METRICS_SOURCE);
    // Paridade: mesmo universo ativo → mesmo soldAmount do motor
    assert.equal(official.soldAmount, 5000);
  });
});
