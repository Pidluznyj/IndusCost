import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceAccountsReceivableDashboard,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  parseFinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { financeSalesOrdersMetricsAreFinite } from "./financeSalesOrdersDashboard.js";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "./financeSalesOrdersDashboardTypes.js";
import { buildFinanceTabLoadError, financeApiErrorJson } from "./financeTabLoadError.js";

const ROOT = process.cwd();

type FinanceTabSpec = {
  id: string;
  label: string;
  page: string;
  routes: string;
  endpoint: string;
  dashboardTest: string;
};

const REGISTER_FN: Record<string, string> = {
  "cash-flow": "registerFinanceCashFlowRoutes",
  "accounts-receivable": "registerFinanceAccountsReceivableRoutes",
  "accounts-payable": "registerFinanceAccountsPayableRoutes",
  billing: "registerFinanceBillingRoutes",
  "sales-orders": "registerFinanceSalesOrdersRoutes",
  "executive-report": "registerFinanceExecutiveReportRoutes",
};

const FINANCE_TABS: FinanceTabSpec[] = [
  {
    id: "cash-flow",
    label: "Fluxo de Caixa",
    page: "src/components/finance/FinanceCashFlowPage.tsx",
    routes: "src/lib/financeCashFlowRoutes.ts",
    endpoint: "/api/finance/cash-flow/dashboard",
    dashboardTest: "src/lib/financeCashFlowDashboard.test.ts",
  },
  {
    id: "accounts-receivable",
    label: "Contas a Receber",
    page: "src/components/finance/FinanceAccountsReceivablePage.tsx",
    routes: "src/lib/financeAccountsReceivableRoutes.ts",
    endpoint: "/api/finance/accounts-receivable/dashboard",
    dashboardTest: "src/lib/financeAccountsReceivableDashboard.test.ts",
  },
  {
    id: "accounts-payable",
    label: "Contas a Pagar",
    page: "src/components/finance/FinanceAccountsPayablePage.tsx",
    routes: "src/lib/financeAccountsPayableRoutes.ts",
    endpoint: "/api/finance/accounts-payable/dashboard",
    dashboardTest: "src/lib/financeAccountsPayableDashboard.test.ts",
  },
  {
    id: "billing",
    label: "Faturamento",
    page: "src/components/finance/FinanceBillingPage.tsx",
    routes: "src/lib/financeBillingRoutes.ts",
    endpoint: "/api/finance/billing/dashboard",
    dashboardTest: "src/lib/financeBillingDashboard.test.ts",
  },
  {
    id: "sales-orders",
    label: "Pedidos de Venda",
    page: "src/components/finance/FinanceSalesOrdersPage.tsx",
    routes: "src/lib/financeSalesOrdersRoutes.ts",
    endpoint: "/api/finance/sales-orders/dashboard",
    dashboardTest: "src/lib/financeSalesOrdersDashboard.test.ts",
  },
  {
    id: "executive-report",
    label: "Relatório Presidencial",
    page: "src/components/finance/FinanceExecutiveReportPage.tsx",
    routes: "src/lib/financeExecutiveReportRoutes.ts",
    endpoint: "/api/finance/executive-report",
    dashboardTest: "src/lib/financeExecutiveReport.test.ts",
  },
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("financeModuleTabsValidation", () => {
  const financeModule = read("src/components/FinanceModule.tsx");
  const server = read("server.ts");

  for (const tab of FINANCE_TABS) {
    describe(tab.label, () => {
      it("endpoint registrado no server e rotas", () => {
        assert.ok(existsSync(join(ROOT, tab.page)));
        assert.ok(existsSync(join(ROOT, tab.routes)));
        assert.ok(existsSync(join(ROOT, tab.dashboardTest)));
        assert.match(server, new RegExp(REGISTER_FN[tab.id]!));
        assert.match(read(tab.routes), new RegExp(tab.endpoint.replace(/\//g, "\\/")));
      });

      it("página referenciada no FinanceModule", () => {
        const pageName = tab.page.split("/").pop()!.replace(".tsx", "");
        assert.match(financeModule, new RegExp(pageName));
      });

      it("página tem loading e tratamento de erro", () => {
        const page = read(tab.page);
        assert.match(page, /loading|Loader2|Carregando|FinanceModulePageLoading/i);
        assert.match(page, /setError|setDashboardError|dashboardError|buildFinanceTabLoadError/i);
      });
    });
  }

  it("Fluxo de Caixa — payload vazio sem NaN", () => {
    const filters = parseFinanceCashFlowDashboardFilters({ year: "2026" });
    const payload = buildFinanceCashFlowDashboard([], [], filters, new Date(2026, 5, 15));
    assert.equal(payload.monthlySeries.length, 12);
    for (const point of payload.monthlySeries) {
      assert.ok(point.inflowAmount == null || Number.isFinite(point.inflowAmount));
      assert.ok(point.outflowAmount == null || Number.isFinite(point.outflowAmount));
    }
  });

  it("Contas a Receber — payload vazio sem NaN", () => {
    const payload = buildFinanceAccountsReceivableDashboard([], { status: "all" }, new Date(2026, 5, 15));
    assert.ok(Number.isFinite(payload.cards.totalOpenAmount));
    assert.ok(Number.isFinite(payload.cards.overdueAmount));
  });

  it("Contas a Pagar — payload vazio sem NaN", () => {
    const payload = buildFinanceAccountsPayableDashboard([], { status: "all" }, new Date(2026, 5, 15));
    assert.ok(Number.isFinite(payload.cards.totalOpenAmount));
    assert.ok(Number.isFinite(payload.cards.overdueAmount));
  });

  it("Pedidos de Venda — contrato mínimo finito com dados zerados", () => {
    const payload = {
      summary: {
        totalOrdersAmount: 0,
        monthSalesAmount: 0,
        ytdSalesAmount: 0,
        monthTargetAmount: null,
        yearTargetAmount: null,
        monthTargetConfigured: false,
        openPortfolioAmount: 0,
        orderCount: 0,
        itemCount: 0,
      },
      monthlyComparison: FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, i) => ({
        month: i + 1,
        monthLabel,
        currentYearAmount: 0,
        previousYearAmount: 0,
        differenceAmount: 0,
        growthPercent: 0,
      })),
      topCustomers: [],
      topSellers: [],
      manufacturingStatusBreakdown: [],
      logisticStatusBreakdown: [],
      criticalOrders: [],
      openPortfolioEvolution: [],
    } as never;
    assert.equal(financeSalesOrdersMetricsAreFinite(payload), true);
  });

  it("filtros principais não quebram parse de AR/AP/Fluxo", () => {
    const cf = parseFinanceCashFlowDashboardFilters({
      year: "2026",
      month: "6",
      company: "SM",
      status: "open",
    });
    assert.equal(cf.year, 2026);
    assert.equal(cf.month, 6);
  });

  it("AP e Billing propagam erro técnico na UI", () => {
    assert.match(read("src/components/finance/FinanceAccountsPayablePage.tsx"), /buildFinanceTabLoadError/);
    assert.match(read("src/components/finance/FinanceBillingPage.tsx"), /buildFinanceTabLoadError/);
    assert.match(read("src/lib/financeAccountsPayableRoutes.ts"), /financeApiErrorJson/);
    assert.match(read("src/lib/financeBillingRoutes.ts"), /financeApiErrorJson/);
  });

  it("frontend não quebra com payload vazio — empty states", () => {
    assert.match(read("src/components/finance/FinanceSalesOrdersPage.tsx"), /FinanceModuleEmptyState|FinanceBiEmptyState/);
    assert.match(
      read("src/components/finance/FinanceAccountsReceivableTitlesTab.tsx"),
      /TabEmpty/
    );
    assert.match(read("src/components/finance/FinanceCashFlowPage.tsx"), /FinanceBiEmptyState|empty/i);
  });
});

describe("financeTabLoadError", () => {
  it("buildFinanceTabLoadError inclui detalhe", () => {
    const msg = buildFinanceTabLoadError("Falha ao carregar.", new Error("timeout"));
    assert.match(msg, /Falha ao carregar\./);
    assert.match(msg, /timeout/);
  });

  it("financeApiErrorJson separa mensagem amigável e técnica", () => {
    const body = financeApiErrorJson("Erro amigável.", new Error("Prisma timeout"));
    assert.equal(body.error, "Erro amigável.");
    assert.equal(body.message, "Prisma timeout");
  });
});
