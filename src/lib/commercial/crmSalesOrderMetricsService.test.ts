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
  RANKING_TOP_N,
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
    externalSellerId: null,    responsible: null,
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
        externalSellerId: null,      }),
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

/**
 * Espelho do Pedidos de Venda (17/08/2026): o cockpit do gestor comercial só
 * serve se cada número tiver a MESMA régua da tela oficial de pedidos.
 */
describe("crmSalesOrderMetrics — espelho da tela Pedidos de Venda", () => {
  const intercompany = order({
    id: "ic-1",
    orderCode: "IC-1",
    customerId: "cust-grupo",
    totalNetValue: 500000,
    Customer: {
      companyName: "Koppetel Comercio de Plasticos LTDA",
      tradeName: "KOPPETEL",
      taxId: "14.055.501/0001-80",
      CrmCustomerCommercialOwner: null,
    },
  });
  const mercado = order({ id: "mk-1", orderCode: "MK-1", totalNetValue: 1000 });

  it("venda intercompany não entra em ranking, cliente nem valor", () => {
    const metrics = buildCrmSalesOrderMetrics({ orders: [mercado, intercompany] });
    assert.equal(metrics.customersWithOrders, 1, "Koppetel não é cliente do mercado");
    assert.ok(
      !metrics.topCustomers.some((row) => row.label.toUpperCase().includes("KOPPETEL")),
      "empresa do grupo não pode aparecer no Top clientes"
    );
    // Reconciliação é contra o ranking COMPLETO (todos os clientes).
    // Σ do Top N só coincide por acaso quando há ≤ 10 grupos.
    assert.equal(metrics.customerRankingTotals.value, metrics.totalOrderValue);
    assert.equal(metrics.customerRankingTotals.orders, metrics.totalOrders);
  });

  it("ranking completo de responsáveis reconcilia com o valor vendido", () => {
    const metrics = buildCrmSalesOrderMetrics({ orders: [mercado, intercompany] });
    assert.equal(metrics.commercialOwnerRankingTotals.value, metrics.totalOrderValue);
    assert.equal(metrics.commercialOwnerRankingTotals.orders, metrics.totalOrders);
  });

  it("pedido sem cliente vinculado vira qualidade de dado, não vira cliente", () => {
    const semCliente = order({
      id: "nc-1",
      orderCode: "NC-1",
      customerId: null,
      Customer: { companyName: "Sem vínculo", tradeName: null, CrmCustomerCommercialOwner: null },
    });
    const metrics = buildCrmSalesOrderMetrics({ orders: [mercado, semCliente] });
    assert.equal(metrics.customersWithOrders, 1);
    assert.equal(metrics.ordersWithoutCustomerLink, 1);
  });

  it("só o CANCELADO sai do valor vendido — ERROR conta, como na tela Pedidos", () => {
    // A tela Pedidos de Venda exclui apenas CANCELLED (where + motor). O CRM
    // excluía ERROR também, o que tornava a reconciliação impossível.
    const cancelado = order({ id: "cc-1", orderCode: "CC-1", status: "CANCELLED", totalNetValue: 9999 });
    const erro = order({ id: "er-1", orderCode: "ER-1", status: "ERROR", totalNetValue: 700 });
    const metrics = buildCrmSalesOrderMetrics({ orders: [mercado, cancelado, erro] });
    assert.equal(metrics.totalOrderValue, 1700);
    assert.equal(metrics.totalOrders, 2);
    assert.equal(metrics.canceledOrders, 1);
  });
});

describe("crmSalesOrderMetrics — Top N exibido × ranking de reconciliação", () => {
  /** 13 clientes: mais grupos do que o Top N exibido (10). */
  const many = Array.from({ length: 13 }, (_, i) =>
    order({
      id: `m-${i}`,
      orderCode: `M-${i}`,
      customerId: `cust-${i}`,
      totalNetValue: 100 * (i + 1),
      Customer: {
        companyName: `Cliente ${i}`,
        tradeName: null,
        CrmCustomerCommercialOwner: null,
      },
    })
  );

  it("Σ do Top N NÃO fecha com o valor vendido quando há mais grupos que o Top", () => {
    const metrics = buildCrmSalesOrderMetrics({ orders: many });
    const somaTopN = metrics.topCustomers.reduce((sum, row) => sum + row.value, 0);
    assert.equal(metrics.topCustomers.length, RANKING_TOP_N);
    assert.ok(
      somaTopN < metrics.totalOrderValue,
      "afirmar Σ(Top N) = total seria matematicamente errado"
    );
    assert.equal(metrics.customerRankingTotals.truncatedForDisplay, true);
  });

  it("o ranking COMPLETO fecha no centavo com o valor vendido", () => {
    const metrics = buildCrmSalesOrderMetrics({ orders: many });
    assert.equal(metrics.customerRankingTotals.groups, 13);
    assert.equal(metrics.customerRankingTotals.value, metrics.totalOrderValue);
    assert.equal(metrics.customerRankingTotals.orders, metrics.totalOrders);
  });

  it("Top produtos soma LINHA e não deve ser reconciliado com o header", () => {
    // Produto só existe na linha do pedido; o valor vendido é o header.
    // Documentado para ninguém escrever um teste forçando igualdade.
    const comItens = order({
      id: "it-1",
      orderCode: "IT-1",
      totalNetValue: 1000,
      items: [
        { productId: "p1", productNameSnapshot: "Produto 1", quantity: 1, totalNetValue: 400 },
        { productId: "p2", productNameSnapshot: "Produto 2", quantity: 1, totalNetValue: 300 },
      ],
    });
    const metrics = buildCrmSalesOrderMetrics({ orders: [comItens] });
    const somaProdutos = metrics.topProducts.reduce((sum, row) => sum + row.value, 0);
    assert.equal(somaProdutos, 700);
    assert.equal(metrics.totalOrderValue, 1000);
    assert.notEqual(somaProdutos, metrics.totalOrderValue);
  });
});
