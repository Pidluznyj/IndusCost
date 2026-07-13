import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildManagementKpiCards } from "@/src/components/crmManagementUi";
import {
  buildManagementRiskReasons,
  buildManagementSuggestedAction,
  computeManagementTicketAverage,
  MANAGEMENT_RISK_REASON_CODES,
} from "@/src/lib/crmManagementDashboard";
import { isOpenPortfolioSalesOrder } from "@/src/lib/crmCommercialOrderRules";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const SINCE90 = new Date("2026-03-14T12:00:00.000Z");
const SINCE30 = new Date("2026-05-13T12:00:00.000Z");

const fmtNum = (v: number | null | undefined) => String(v ?? 0);
const fmtCur = (v: unknown) => String(v ?? 0);

describe("crmManagementDashboard", () => {
  it("risk reasons usam pedidos, não propostas", () => {
    const reasons = buildManagementRiskReasons({
      riskLevel: "HIGH",
      hasOrderNoFollowUp: true,
      lastPurchaseAt: null,
      openOrdersCount: 2,
      since90: SINCE90,
    });
    assert.ok(reasons.includes(MANAGEMENT_RISK_REASON_CODES.ORDER_WITHOUT_FOLLOW_UP));
    assert.ok(!reasons.includes("PROPOSAL_WITHOUT_FOLLOW_UP"));
    assert.ok(!reasons.includes("OPEN_PROPOSALS"));
  });

  it("oportunidade não prioriza openProposalsCount", () => {
    const action = buildManagementSuggestedAction({
      lastPurchaseAt: new Date("2026-05-20T00:00:00.000Z"),
      lastContactAt: new Date("2026-05-25T00:00:00.000Z"),
      openOrdersCount: 0,
      tier: 2,
      since30: SINCE30,
    });
    assert.match(action, /pós-venda|oportunidade/i);
    assert.doesNotMatch(action, /proposta/i);
  });

  it("buildSuggestedAction usa pedido/carteira/recompra", () => {
    assert.equal(
      buildManagementSuggestedAction({
        lastPurchaseAt: null,
        lastContactAt: null,
        openOrdersCount: 3,
        tier: 3,
        since30: SINCE30,
      }),
      "Acompanhar pedido em carteira."
    );
    assert.equal(
      buildManagementSuggestedAction({
        lastPurchaseAt: new Date("2026-01-01T00:00:00.000Z"),
        lastContactAt: new Date("2026-04-01T00:00:00.000Z"),
        openOrdersCount: 0,
        tier: 3,
        since30: SINCE30,
      }),
      "Retomar cliente sem pedido recente."
    );
  });

  it("carteira aberta usa pedido válido sem NF", () => {
    assert.equal(
      isOpenPortfolioSalesOrder({
        status: "READY_TO_SEND",
        nomusRawResponse: { nfes: [] },
      }),
      true
    );
    assert.equal(
      isOpenPortfolioSalesOrder({
        status: "CANCELLED",
        nomusRawResponse: { nfes: [] },
      }),
      false
    );
    assert.equal(
      isOpenPortfolioSalesOrder({
        status: "SENT_TO_NOMUS",
        nomusRawResponse: { nfes: [{ dataProcessamento: "10/05/2026" }] },
      }),
      false
    );
  });

  it("UI não exibe Propostas abertas como card principal", () => {
    const cards = buildManagementKpiCards(
      {
        totalCustomers: 10,
        customersWithContactLast30Days: 5,
        customersWithoutContactLast30Days: 5,
        customersWithoutContactLast60Days: 3,
        customersWithoutContactLast90Days: 2,
        customersWithoutValidPurchase: 1,
        customersWithoutPurchase90Days: 1,
        customersWithoutPurchase180Days: 0,
        contactsLast7Days: 2,
        contactsLast30Days: 8,
        overdueFollowUps: 1,
        upcomingFollowUpsNext7Days: 2,
        upcomingFollowUpsNext30Days: 4,
        openOrdersCount: 7,
        openOrdersValue: 125000,
        ordersWithoutFollowUpCount: 2,
        customersAtHighRisk: 3,
      },
      fmtNum,
      fmtCur
    );
    const labels = cards.map((c) => c.label);
    assert.ok(labels.includes("Pedidos em carteira"));
    assert.ok(labels.includes("Valor em carteira"));
    assert.ok(labels.includes("Pedidos sem follow-up"));
    assert.equal(labels.some((l) => l === "Propostas abertas"), false);
  });

  it("não retorna NaN/Infinity no ticket médio", () => {
    assert.equal(computeManagementTicketAverage(1000, 0), 0);
    assert.equal(computeManagementTicketAverage(Number.NaN, 5), 0);
    const avg = computeManagementTicketAverage(10000, 4);
    assert.ok(Number.isFinite(avg));
  });

  it("serviço gerencial consulta SalesOrder, não Proposal", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmManagementDashboardService.ts"),
      "utf8"
    );
    assert.match(service, /"SalesOrder"/);
    assert.equal(service.includes('"Proposal"'), false);
    assert.match(service, /loadCrmSalesOrderMetrics/);
    assert.match(service, /openOrdersCount/);
    assert.match(service, /ordersWithoutFollowUp/);
  });

  it("endpoint management-dashboard delega ao serviço de pedidos", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf("/api/crm/management-dashboard");
    assert.ok(start >= 0, "rota management-dashboard deve existir");
    const block = server.slice(start, start + 2500);
    assert.match(block, /buildCrmManagementDashboardResponse/);
    assert.match(block, /dateFrom/);
    assert.match(block, /dateTo/);
    assert.equal(block.includes("openProposalsCount"), false);
    assert.equal(block.includes('"Proposal"'), false);
  });
});
