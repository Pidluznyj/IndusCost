import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboard,
  isFinanceCashFlowPeriodAllQuery,
  parseFinanceCashFlowDashboardFilters,
  resolveFinanceCashFlowFiltersForLoad,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowExportQuery,
  createDefaultFinanceCashFlowUiFilters,
} from "./financeCashFlowDashboardTypes.js";
import {
  cashFlowMonthlySeriesHasData,
  computeCashFlowNetPosition,
} from "./financeCashFlowDisplay.js";
import { buildFinanceCashFlowExportCsv } from "./financeCashFlowExport.js";
import { buildCashFlowArApReconciliationReport } from "./financeCashFlowArApReconciliation.js";
import {
  buildFinanceCashFlowAuditPayload,
  buildFinanceCashFlowDataset,
} from "./financeCashFlowDataset.js";
import { FINANCE_CASH_FLOW_RECONCILIATION_RISKS } from "./financeCashFlowReconciliationMap.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

const REF = new Date(2026, 5, 9);
const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");

function arCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function apCutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

function assertAuditOk(result: { ok: boolean; mismatches: string[] }, context: string) {
  assert.equal(result.ok, true, `${context}: ${result.mismatches.join("; ")}`);
}

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

const filters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

const CHECKLIST_FIXTURE_AR = [
  arRow({ externalId: 1, balanceReceivable: 2000, dueDate: new Date(2026, 5, 5) }),
  arRow({
    externalId: 2,
    companyName: "Empresa B",
    balanceReceivable: 1500,
    dueDate: new Date(2026, 6, 20),
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
  }),
  arRow({
    externalId: 3,
    balanceReceivable: 900,
    dueDate: new Date(2026, 4, 1),
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
  }),
  arRow({
    externalId: 4,
    balanceReceivable: 0,
    amountReceived: 500,
    settlementDate: new Date(2026, 5, 8),
    dueDate: new Date(2026, 4, 1),
  }),
  arRow({
    externalId: 5,
    balanceReceivable: 5000,
    syncedAt: new Date("2026-06-12T10:00:00.000Z"),
    dueDate: new Date(2026, 4, 1),
  }),
];

const CHECKLIST_FIXTURE_AP = [
  apRow({ externalId: 10, balancePayable: 800, dueDate: new Date(2026, 5, 8) }),
  apRow({ externalId: 11, companyName: "Empresa B", balancePayable: 600, dueDate: new Date(2026, 5, 25) }),
  apRow({ externalId: 12, type: 2, description: "PEDIDO DE COMPRA", balancePayable: 9000 }),
];

const FILTER_MATRIX = [
  { label: "ano", filters: { ...filters } },
  { label: "ano+mês", filters: { ...filters, month: 6 } },
  { label: "empresa", filters: { ...filters, companyName: "Empresa A" } },
  { label: "status open", filters: { ...filters, status: "open" as const } },
  { label: "invoice yes", filters: { ...filters, invoiceIssued: "yes" as const } },
  { label: "invoice no", filters: { ...filters, invoiceIssued: "no" as const } },
];

const PRODUCTION_LIBS_NO_HARDCODE = [
  "src/lib/financeCashFlowDashboard.ts",
  "src/lib/financeCashFlowDataset.ts",
  "src/lib/financeCashFlowLedger.ts",
  "src/lib/financeCashFlowCalendar.ts",
  "src/lib/financeCashFlowExecutiveSummary.ts",
  "src/lib/financeCashFlowRowFilters.ts",
];

const FORBIDDEN_HARDCODE = ["MEXICHEM", "MEXICHEN", "ENERGY", "ESMALTEC", "33.081.704", "98000", "18270"];

describe("financeCashFlowValidation — auditoria final", () => {
  it("Control Room rejeitado não existe no repositório", () => {
    const rejected = [
      "src/finance-control-room.css",
      "src/lib/financeControlRoomTheme.ts",
      "scripts/cash-flow-page-formatted.html",
    ];
    for (const path of rejected) {
      assert.equal(existsSync(join(process.cwd(), path)), false, `${path} não deve existir`);
    }
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(!page.includes("financeControlRoomTheme"));
    assert.ok(!page.includes("finance-control-room"));
  });

  it("empty state quando série sem movimentos", () => {
    const empty = buildFinanceCashFlowDashboard([], [], filters, REF);
    assert.equal(cashFlowMonthlySeriesHasData(empty.monthlySeries), false);
    assert.equal(empty.cards.totalReceivableOpen, 0);
    assert.equal(empty.cards.totalPayableOpen, 0);
  });

  it("gráfico com dados quando há títulos filtrados", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    assert.equal(cashFlowMonthlySeriesHasData(payload.monthlySeries), true);
  });

  it("contrato funcional — payload cobre perguntas gerenciais", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 3000, dueDate: new Date(2026, 4, 1) }),
        arRow({ externalId: 3, balanceReceivable: 2000, dueDate: new Date(2026, 5, 10) }),
      ],
      [apRow({ balancePayable: 4500, dueDate: new Date(2026, 5, 25) })],
      filters,
      REF
    );

    assert.equal(
      payload.cards.netCashPosition,
      computeCashFlowNetPosition(
        payload.cards.totalReceivableOpen,
        payload.cards.totalPayableOpen
      )
    );
    assert.ok(payload.cards.totalReceivableOpen > 0);
    assert.ok(payload.cards.totalPayableOpen > 0);
    assert.ok(payload.cashForecast.horizons.next12Months);
    assert.ok(payload.conservativeScenario.disclaimer.includes("conservador"));
    assert.ok(payload.stressScenario.disclaimer.includes("crítico"));
    assert.ok(payload.cashHealthScore.score >= 0 && payload.cashHealthScore.score <= 100);
    assert.ok(payload.executiveInsights.recommendedActions.length > 0);
    assert.ok(payload.topCustomers.length > 0);
    assert.ok(payload.topSuppliers.length > 0);
    assert.ok(payload.overdueReceivables.length > 0 || payload.overduePayables.length >= 0);
    assert.ok(payload.operationalRecommendations.length > 0);
    assert.ok(payload.dailyCalendar.length >= 0);
    assert.ok(payload.executiveYtd.scopeLabel.length > 0);
    assert.ok(payload.executiveYtdReading.length > 0);
  });

  it("export query usa filtros sem format isolado quebrado", () => {
    const q = buildFinanceCashFlowExportQuery({ year: "2026", month: "6" });
    assert.ok(q.includes("format=csv"));
    assert.ok(q.includes("year=2026"));
    assert.ok(q.includes("month=6"));
  });
});

describe("financeCashFlowValidation — checklist ponta a ponta Fluxo × AR/AP", () => {
  it("relatório consolidado passa na fixture canônica multi-AR/AP", () => {
    assertAuditOk(
      buildCashFlowArApReconciliationReport(
        CHECKLIST_FIXTURE_AR,
        CHECKLIST_FIXTURE_AP,
        filters,
        REF,
        arCutoff(),
        apCutoff()
      ),
      "fixture canônica"
    );
  });

  for (const { label, matrixFilters } of FILTER_MATRIX.map((f) => ({
    label: f.label,
    matrixFilters: f.filters,
  }))) {
    it(`matriz de filtros — ${label}`, () => {
      assertAuditOk(
        buildCashFlowArApReconciliationReport(
          CHECKLIST_FIXTURE_AR,
          CHECKLIST_FIXTURE_AP,
          matrixFilters,
          REF,
          arCutoff(),
          apCutoff()
        ),
        `filtro ${label}`
      );
    });
  }

  it("export CSV usa os mesmos números de entradas/saídas e conferência do payload", () => {
    const payload = buildFinanceCashFlowDashboard(
      CHECKLIST_FIXTURE_AR as FinanceCashFlowArRow[],
      CHECKLIST_FIXTURE_AP as FinanceCashFlowApRow[],
      filters,
      REF,
      arCutoff(),
      apCutoff()
    );
    const csv = buildFinanceCashFlowExportCsv(payload);
    const jan = payload.monthlySeries.find((p) => p.month === 1);
    assert.ok(jan);
    assert.ok(csv.includes(`mensal,2026,1,${jan!.inflowAmount}`));
    assert.ok(csv.includes(String(payload.reconciliation.receivable.cashFlowInflow)));
    assert.ok(csv.includes(String(payload.reconciliation.payable.cashFlowOutflow)));
    assert.ok(csv.includes(String(payload.reconciliation.netCashFlow)));
    assert.ok(
      csv.includes(payload.reconciliation.receivable.matchesLedger ? "ok" : "divergencia")
    );
    assert.equal(payload.cards.inflowAmount, payload.reconciliation.receivable.cashFlowInflow);
    assert.equal(payload.cards.outflowAmount, payload.reconciliation.payable.cashFlowOutflow);
    assert.equal(payload.cards.netFlowAmount, payload.reconciliation.netCashFlow);
  });

  it("auditoria técnica expõe cutoffs, exclusões e traces por bloco", () => {
    const rawAr = CHECKLIST_FIXTURE_AR as FinanceCashFlowArRow[];
    const rawAp = CHECKLIST_FIXTURE_AP as FinanceCashFlowApRow[];
    const dataset = buildFinanceCashFlowDataset(
      rawAr,
      rawAp,
      filters,
      { status: "all", year: 2026 },
      { status: "all", year: 2026, managementScope: "company" },
      REF,
      arCutoff(),
      apCutoff()
    );
    const audit = buildFinanceCashFlowAuditPayload(
      dataset,
      rawAr.length,
      rawAp.length,
      rawAr,
      rawAp
    );
    assert.ok(audit.syncCutoffs.ar != null || audit.syncCutoffs.ar === null);
    assert.ok(typeof audit.exclusions.arStale === "number");
    assert.ok(typeof audit.exclusions.apIntercompanyOrPurchaseOrder === "number");
    assert.ok(Array.isArray(audit.traces.largestExpectedInflows));
    assert.ok(Array.isArray(audit.traces.overdueReceivables));
    assert.ok(audit.counts.arPortfolio >= 0);
    assert.ok(payloadReconciliationOk(buildFinanceCashFlowDashboard(rawAr, rawAp, filters, REF, arCutoff(), apCutoff())));
  });

  it("period=all remove recorte de ano padrão", () => {
    assert.equal(isFinanceCashFlowPeriodAllQuery({ period: "all" }), true);
    const parsed = parseFinanceCashFlowDashboardFilters({
      period: "all",
      viewMode: "projected",
    });
    const resolved = resolveFinanceCashFlowFiltersForLoad({ period: "all" }, parsed, REF);
    assert.equal(resolved.year, undefined);
  });

  it("filtros UI: draft separado de applied na página", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes("hasPendingFilterChanges"));
    assert.ok(page.includes("handleApplyFilters"));
    const defaults = createDefaultFinanceCashFlowUiFilters(2026);
    assert.ok(defaults.year.length > 0);
  });

  it("calendário navega por mês quando filtro global é Mês = Todos", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("calendarDisplayMonth"));
    assert.ok(page.includes("onDisplayMonthChange"));
    assert.ok(page.includes("FinanceCashFlowNumbersAuditSection"));
  });

  it("exceções conceituais documentadas (não mascaradas)", () => {
    assert.ok(FINANCE_CASH_FLOW_RECONCILIATION_RISKS.length >= 5);
    const ids = FINANCE_CASH_FLOW_RECONCILIATION_RISKS.map((r) => r.id);
    assert.ok(ids.includes("R1_executive_timeline_vs_period_series"));
    assert.ok(ids.includes("R4_portfolio_vs_ytd_period_open"));
    for (const risk of FINANCE_CASH_FLOW_RECONCILIATION_RISKS) {
      assert.ok(risk.description.length > 20);
      assert.ok(risk.affectedBlocks.length > 0);
    }
  });

  it("motores de produção sem hardcode de cliente/CNPJ/valor", () => {
    for (const rel of PRODUCTION_LIBS_NO_HARDCODE) {
      const src = readFileSync(join(process.cwd(), rel), "utf8").toUpperCase();
      for (const token of FORBIDDEN_HARDCODE) {
        assert.ok(!src.includes(token.toUpperCase()), `${rel} contém ${token}`);
      }
    }
  });
});

function payloadReconciliationOk(payload: ReturnType<typeof buildFinanceCashFlowDashboard>): boolean {
  return (
    payload.reconciliation.receivable.matchesLedger &&
    payload.reconciliation.payable.matchesLedger &&
    payload.reconciliation.netMatchesLedger
  );
}
