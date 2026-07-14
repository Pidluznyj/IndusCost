import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildSellerKpiCards } from "@/src/components/crmSellerDashboardUi";
import {
  computeSellerTicketAverage,
  sellerDashToNumber,
} from "@/src/lib/crmSellerDashboard";
import { isOpenPortfolioSalesOrder } from "@/src/lib/crmCommercialOrderRules";
import {
  buildSellerDashboardSourceInfo,
  mergeOfficialMetricsIntoSellerSummary,
} from "@/src/lib/crmSellerDashboardOfficialOrders";
import {
  buildCrmSalesOrderMetrics,
  type CrmMetricsOrderInput,
} from "@/src/lib/commercial/crmSalesOrderMetricsService";

const fmtNum = (v: number | null | undefined) => String(v ?? 0);
const fmtCur = (v: unknown) => String(v ?? 0);

function order(
  partial: Partial<CrmMetricsOrderInput> & Pick<CrmMetricsOrderInput, "id" | "orderCode">
): CrmMetricsOrderInput {
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

describe("crmSellerDashboard", () => {
  it("ticket médio usa pedidos válidos", () => {
    assert.equal(computeSellerTicketAverage(50000, 10), 5000);
    assert.equal(computeSellerTicketAverage(50000, 0), 0);
    assert.equal(computeSellerTicketAverage(Number.POSITIVE_INFINITY, 2), 0);
  });

  it("sellerDashToNumber não retorna NaN", () => {
    assert.equal(sellerDashToNumber("bad"), 0);
    assert.equal(sellerDashToNumber(12500.5), 12500.5);
    assert.ok(Number.isFinite(sellerDashToNumber(null)));
  });

  it("carteira aberta usa SalesOrder, não Proposal", () => {
    assert.equal(
      isOpenPortfolioSalesOrder({
        status: "READY_TO_SEND",
        nomusRawResponse: {},
      }),
      true
    );
    assert.equal(
      isOpenPortfolioSalesOrder({ status: "ERROR", nomusRawResponse: {} }),
      false
    );
  });

  it("UI não usa Propostas como KPI principal", () => {
    const cards = buildSellerKpiCards(
      {
        ordersCount: 12,
        ordersValue: 240000,
        invoicedOrdersCount: 8,
        invoicedOrdersValue: 180000,
        openOrdersCount: 4,
        openOrdersValue: 60000,
        cancelledOrdersCount: 1,
        uniqueCustomersCount: 9,
        ticketAverage: 20000,
        topProduct: {
          productId: "p1",
          productName: "Motor 3CV",
          sku: "MOT-3",
          revenue: 80000,
          quantity: 40,
        },
        ordersWithoutLinkedProposalCount: 2,
      },
      fmtNum,
      fmtCur
    );
    const labels = cards.map((c) => c.label);
    assert.ok(labels.includes("Pedidos emitidos"));
    assert.ok(labels.includes("Carteira aberta"));
    assert.ok(labels.includes("Ticket médio"));
    assert.ok(labels.includes("Produto líder"));
    assert.equal(labels.some((l) => l === "Propostas abertas"), false);
    assert.equal(labels.some((l) => l.includes("Propostas sem pedido")), false);
    const traceCard = cards.find((c) => c.label.includes("sem proposta"));
    assert.ok(traceCard?.description?.includes("rastreabilidade"));
  });

  it("serviço por vendedor usa responsável comercial + SalesOrder (não Proposal/cálculo de comissão)", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmSellerDashboardService.ts"),
      "utf8"
    );
    assert.match(service, /buildCrmCommercialOwnerOnlyOrderScopeSql/);
    assert.match(service, /buildCrmSalesOrderMetrics/);
    assert.match(service, /CrmCustomerCommercialOwner/);
    assert.match(service, /sourceInfo/);
    assert.match(service, /RESPONSAVEL_COMERCIAL_CLIENTE|buildSellerDashboardSourceInfo/);
    assert.equal(service.includes('"Proposal"'), false);
    // CommissionPerson/Alias só para resolver nome do Vendedor do Pedido (não calcular comissão).
    assert.match(service, /mergeCommissionSellerNamesIntoMap|commissionPerson/);
    assert.doesNotMatch(service, /commissionExpectedAmount|CommissionOrderSnapshot/);
    assert.equal(service.includes("buildCrmSellerPortfolioOrderScopeSql"), false);
  });

  it("endpoint seller-dashboard delega ao serviço de pedidos", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf("/api/crm/seller-dashboard");
    assert.ok(start >= 0, "rota seller-dashboard deve existir");
    const block = server.slice(start, start + 2500);
    assert.match(block, /buildCrmSellerDashboardResponse/);
    assert.equal(block.includes("openProposalsCount"), false);
    assert.equal(block.includes('"Proposal"'), false);
  });

  it("sourceInfo declara eixo responsável comercial e comissão não afetada", () => {
    const info = buildSellerDashboardSourceInfo({
      period: { dateFrom: "2026-06-13", dateTo: "2026-07-12" },
    });
    assert.equal(info.eixo, "RESPONSAVEL_COMERCIAL_CLIENTE");
    assert.equal(info.pedidosFonte, "SalesOrder");
    assert.equal(info.itensFonte, "SalesOrderItem");
    assert.equal(info.vendedorPedidoFonte, "Nomus/SalesOrder seller field");
    assert.equal(info.comissionamentoAfetado, false);
  });

  it("responsável com clientes/pedidos retorna indicadores > 0", () => {
    const metrics = buildCrmSalesOrderMetrics({
      orders: [
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
          totalNetValue: 3000,
          nomusSellerName: null,
          externalSellerId: null,
        }),
      ],
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    const summary = mergeOfficialMetricsIntoSellerSummary({ metrics });
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.totalOrderValue, 8000);
    assert.ok((summary.totalOrders ?? 0) > 0);
    assert.equal(summary.ordersWithoutNomusSeller, 1);
    assert.equal(summary.ordersWithDifferentNomusSeller, 1);
  });

  it("responsável sem clientes/pedidos = empty state (zeros)", () => {
    const metrics = buildCrmSalesOrderMetrics({
      orders: [
        order({
          id: "o1",
          orderCode: "1",
          Customer: {
            companyName: "Beta",
            CrmCustomerCommercialOwner: {
              sellerCanonicalName: "JOSEANE",
              sellerIdentityKey: "joseane",
              isActive: true,
            },
          },
        }),
      ],
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    const summary = mergeOfficialMetricsIntoSellerSummary({ metrics });
    assert.equal(summary.totalOrders, 0);
    assert.equal(summary.totalOrderValue, 0);
    assert.equal(summary.customersWithOrders, 0);
  });

  it("cliente sem responsável não entra em responsável específico", () => {
    const metrics = buildCrmSalesOrderMetrics({
      orders: [
        order({
          id: "o1",
          orderCode: "1",
          totalNetValue: 9000,
          Customer: {
            companyName: "Sem dono",
            CrmCustomerCommercialOwner: null,
          },
        }),
      ],
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    assert.equal(metrics.totalOrders, 0);
  });

  it("pedido sem vendedor Nomus entra quando cliente tem responsável", () => {
    const metrics = buildCrmSalesOrderMetrics({
      orders: [
        order({
          id: "o1",
          orderCode: "1",
          totalNetValue: 1500,
          nomusSellerName: null,
          externalSellerId: null,
        }),
      ],
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.ordersWithoutNomusSeller, 1);
  });

  it("pedido com vendedor Nomus diferente entra e conta divergência", () => {
    const metrics = buildCrmSalesOrderMetrics({
      orders: [
        order({
          id: "o1",
          orderCode: "1",
          totalNetValue: 2200,
          nomusSellerName: "OUTRO",
          externalSellerId: 111,
        }),
      ],
      filters: { responsibleCommercialName: "GISLENE LIMA" },
    });
    assert.equal(metrics.totalOrders, 1);
    assert.equal(metrics.ordersWithResponsibleDifferentFromOrderSeller, 1);
  });

  it("vendedor com pedidos aparece com valor > 0 no summary tipado", () => {
    const ordersValue = sellerDashToNumber(87500);
    const ticket = computeSellerTicketAverage(ordersValue, 1);
    assert.ok(ordersValue > 0);
    assert.ok(ticket > 0);
    assert.ok(Number.isFinite(ticket));
  });
});
