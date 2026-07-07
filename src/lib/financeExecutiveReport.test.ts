import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExecutiveReportCashFlowAnnualFilters,
  buildExecutiveReportCashFlowFilters,
  buildFinanceExecutiveReportDataQuality,
  mapExecutiveReportCompanyToFilter,
  parseFinanceExecutiveReportQuery,
} from "./financeExecutiveReport.js";
import { buildFinanceExecutiveReportNarrative } from "./financeExecutiveReportNarrative.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApDashboardCards } from "./financeAccountsPayableDashboardTypes.js";

describe("financeExecutiveReport", () => {
  it("parseFinanceExecutiveReportQuery respeita year/month/asOfDate/company/customerType/topN", () => {
    const filters = parseFinanceExecutiveReportQuery(
      {
        year: "2026",
        month: "5",
        asOfDate: "2026-05-14",
        company: "lazarios",
        customerType: "external",
        nfeFilter: "with-nfe",
        topN: "100",
      },
      new Date(2026, 4, 20)
    );
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, 5);
    assert.equal(filters.asOfDate, "2026-05-14");
    assert.equal(filters.company, "lazarios");
    assert.equal(filters.customerType, "external");
    assert.equal(filters.invoiceIssuedFilter, "with-nfe");
    assert.equal(filters.topN, 100);
    assert.equal(mapExecutiveReportCompanyToFilter("lazarios"), "Lazarios");
  });

  it("parseFinanceExecutiveReportQuery exige asOfDate válido", () => {
    assert.throws(
      () => parseFinanceExecutiveReportQuery({ year: "2026" }),
      /asOfDate/
    );
  });

  it("buildFinanceExecutiveReportNarrative gera frases determinísticas", () => {
    const arCards = {
      totalOpenAmount: 250000,
    } as FinanceArDashboardCards;
    const apCards = {
      totalOpenAmount: 80000,
    } as FinanceApDashboardCards;

    const narrative = buildFinanceExecutiveReportNarrative({
      billingTab: {
        target: {
          actual: 900000,
          target: 1000000,
          achievementPercent: 90,
          previousPeriod: 800000,
          gap: 100000,
          formatted: {
            actual: "",
            previousPeriod: "",
            target: "",
            gap: "",
            achievementPercent: "",
          },
        },
      } as never,
      arCards,
      apCards,
      cashFlow: {
        cards: { negativeBalanceMonthsCount: 2 },
      } as never,
      salesOrdersTab: null,
    });

    assert.ok(narrative.sections.some((s) => s.body.toLowerCase().includes("faturamento")));
    assert.ok(narrative.sections.some((s) => s.body.toLowerCase().includes("contas a receber")));
    assert.ok(narrative.sections.some((s) => s.body.includes("saldo líquido negativo")));
  });

  it("dataQuality retorna avisos quando sync/metas faltam", () => {
    const dq = buildFinanceExecutiveReportDataQuality({
      warnings: [],
      unavailableSections: ["billing"],
      sanitization: {
        ignoredInternalGroupReceivables: 0,
        ignoredInternalGroupPayables: 0,
        ignoredGhostReceivables: 0,
        ignoredStaleReceivables: 0,
        ignoredStalePayables: 0,
        ignoredPurchaseOrderAgendaPayables: 0,
        ignoredOverdueWithoutFiscalDocumentReceivables: 0,
        supersededPreInvoiceReceivables: 0,
        supersededPreInvoiceAmount: 0,
      },
      sync: {
        accountsReceivableLastSyncAt: null,
        accountsPayableLastSyncAt: null,
        nfeLastSyncAt: null,
        salesOrdersLastSyncAt: null,
      },
      arStaleExcluded: true,
      apStaleExcluded: true,
      billingTargetMissing: true,
    });

    assert.equal(dq.targetsDerived, true);
    assert.ok(dq.warnings.some((w) => w.includes("Metas")));
    assert.ok(dq.warnings.some((w) => w.includes("Contas a Receber")));
    assert.ok(dq.warnings.some((w) => w.includes("NF-e")));
    assert.ok(dq.unavailableSections.includes("billing"));
  });

  it("serviço AR usa loader canônico loadFinanceArManagementRowsFromPrisma", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReport.ts"),
      "utf8"
    );
    assert.ok(src.includes("loadFinanceArManagementRowsFromPrisma"));
    assert.ok(src.includes("buildOfficialAccountsReceivableDashboard"));
  });

  it("serviço AP usa buildFinanceApPrismaWhere e buildOfficialAccountsPayableDashboard", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("buildFinanceApPrismaWhere"));
    assert.ok(src.includes("buildOfficialAccountsPayableDashboard"));
  });

  it("serviço Fluxo usa buildFinanceCashFlowDashboard", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("buildFinanceCashFlowDashboard"));
    assert.ok(src.includes("buildCashFlowArPrismaWhere"));
  });

  it("serviço Pedidos usa buildSalesOrdersDashboardTab (SalesOrder)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("buildSalesOrdersDashboardTab"));
    assert.ok(!src.includes("buildSalesFunnelDashboardTab"));
  });

  it("rota GET /api/finance/executive-report registrada", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReportRoutes.ts"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.ok(routes.includes('"/api/finance/executive-report"'));
    assert.ok(routes.includes("buildFinanceExecutiveReport"));
    assert.ok(server.includes("registerFinanceExecutiveReportRoutes"));
  });

  it("filtros anuais de fluxo ignoram mês e preservam ano/empresa", () => {
    const filters = parseFinanceExecutiveReportQuery(
      { year: "2026", month: "6", asOfDate: "2026-06-09", company: "lazarios" },
      new Date(2026, 5, 9)
    );
    const period = buildExecutiveReportCashFlowFilters(filters);
    const annual = buildExecutiveReportCashFlowAnnualFilters(filters);
    assert.equal(period.month, 6);
    assert.equal(annual.month, undefined);
    assert.equal(annual.year, 2026);
    assert.equal(annual.companyName, period.companyName);
  });

  it("endpoint retorna estrutura FinanceExecutiveReport documentada", () => {
    const types = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReportTypes.ts"),
      "utf8"
    );
    const report = readFileSync(
      join(process.cwd(), "src/lib/financeExecutiveReport.ts"),
      "utf8"
    );
    for (const key of [
      "billingComparison",
      "billingProjection",
      "accountsReceivable",
      "accountsPayable",
      "cashFlow",
      "calendarAgenda",
      "salesOrders",
      "costCenterSpending",
      "executiveNarrative",
      "dataQuality",
    ]) {
      assert.ok(types.includes(key), key);
      assert.ok(report.includes(key), key);
    }
    assert.ok(types.includes("annualChart"), "annualChart");
    assert.ok(report.includes("cashFlowAnnualChart"), "cashFlowAnnualChart");
  });
});
