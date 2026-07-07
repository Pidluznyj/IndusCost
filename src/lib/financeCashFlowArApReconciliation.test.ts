import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  auditCashFlowApOverdueParityWithAp,
  auditCashFlowApProjectedListsParity,
  auditCashFlowArFiscalBackingParity,
  auditCashFlowArOverdueParityWithAr,
  auditCashFlowArProjectedListsParity,
  auditCashFlowCalendarProjectedParity,
  auditCashFlowExecutiveTimelineInternal,
  auditCashFlowPeriodCardsParity,
  auditCashFlowPortfolioOpenParityWithArAp,
  buildCashFlowArApReconciliationReport,
  toCashFlowPortfolioArFilters,
  toCashFlowPortfolioApFilters,
} from "./financeCashFlowArApReconciliation.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { sumFinanceArOverdueOpenAmount } from "./financeAccountsReceivableOverdue.js";
import { reconcileFinanceModulesFromCashFlowFilters } from "./financeCrossModuleReconciliation.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

const REF = new Date(2026, 5, 17);
const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");

function arCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function apCutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente Alpha",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Beta",
    personCnpj: "22.222.222/0001-22",
    description: "NF serviço",
    dueDate: new Date(2026, 5, 12),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

const BASE_CF_FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

const FILTER_MATRIX: Array<{
  label: string;
  filters: Parameters<typeof buildFinanceCashFlowDashboard>[2];
}> = [
  { label: "ano", filters: { ...BASE_CF_FILTERS } },
  { label: "ano+mês", filters: { ...BASE_CF_FILTERS, month: 6 } },
  { label: "empresa", filters: { ...BASE_CF_FILTERS, companyName: "Empresa A" } },
  { label: "status open", filters: { ...BASE_CF_FILTERS, status: "open" } },
  { label: "invoice yes", filters: { ...BASE_CF_FILTERS, invoiceIssued: "yes" as const } },
  { label: "invoice no", filters: { ...BASE_CF_FILTERS, invoiceIssued: "no" as const } },
];

function assertAuditOk(result: { ok: boolean; mismatches: string[] }, context: string) {
  assert.equal(result.ok, true, `${context}: ${result.mismatches.join("; ")}`);
}

describe("financeCashFlowArApReconciliation — Contas a Receber", () => {
  it("vencidos a receber do Fluxo batem com Atrasados AR (portfólio saneado)", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200, dueDate: new Date(2026, 4, 1) }),
      arRow({ externalId: 2, balanceReceivable: 800, dueDate: new Date(2026, 3, 15) }),
      arRow({
        externalId: 3,
        balanceReceivable: 9000,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 2, 10),
      }),
      arRow({
        externalId: 4,
        balanceReceivable: 0,
        amountReceived: 500,
        settlementDate: new Date(2026, 5, 1),
      }),
      arRow({ externalId: 5, syncedAt: STALE_SYNC, balanceReceivable: 5000, dueDate: new Date(2026, 1, 1) }),
    ];
    const audit = auditCashFlowArOverdueParityWithAr(rows, BASE_CF_FILTERS, REF, arCutoff());
    assertAuditOk(audit, "overdue parity");

    const portfolioFilters = toCashFlowPortfolioArFilters(BASE_CF_FILTERS);
    const arOverdue = sumFinanceArOverdueOpenAmount(rows, portfolioFilters, REF, arCutoff());
    const cf = buildFinanceCashFlowDashboard(rows, [], BASE_CF_FILTERS, REF, arCutoff());
    assert.equal(cf.cards.overdueReceivableAmount, arOverdue);
    assert.equal(arOverdue, 2000);
    assert.ok(!cf.overdueReceivables.some((r) => r.externalId === 3));
    assert.ok(!cf.overdueReceivables.some((r) => r.externalId === 4));
    assert.ok(!cf.overdueReceivables.some((r) => r.externalId === 5));
  });

  it("entradas previstas futuras permitem AR sem NF; vencidos sem NF ficam fora", () => {
    const rows = [
      arRow({
        externalId: 10,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 8, 1),
        balanceReceivable: 1500,
      }),
      arRow({
        externalId: 11,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 2, 1),
        balanceReceivable: 4200,
      }),
    ];
    assertAuditOk(auditCashFlowArFiscalBackingParity(rows, BASE_CF_FILTERS, REF, arCutoff()), "fiscal");

    const cf = buildFinanceCashFlowDashboard(rows, [], BASE_CF_FILTERS, REF, arCutoff());
    assert.ok(cf.largestProjectedInflows.some((r) => r.externalId === 10));
    assert.ok(!cf.overdueReceivables.some((r) => r.externalId === 11));
    assert.equal(cf.cards.overdueReceivableAmount, 0);
  });

  it("top clientes e maiores entradas usam portfólio AR aberto saneado", () => {
    const rows = [
      arRow({ externalId: 1, personName: "Cliente A", balanceReceivable: 3000 }),
      arRow({ externalId: 2, personName: "Cliente B", balanceReceivable: 2000 }),
      arRow({
        externalId: 3,
        personName: "Cliente C",
        balanceReceivable: 5000,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 1, 1),
      }),
    ];
    assertAuditOk(
      auditCashFlowArProjectedListsParity(rows, BASE_CF_FILTERS, REF, arCutoff()),
      "AR lists"
    );
    const cf = buildFinanceCashFlowDashboard(rows, [], BASE_CF_FILTERS, REF, arCutoff());
    assert.equal(cf.topCustomers[0]!.personName, "Cliente A");
    assert.ok(!cf.topCustomers.some((c) => c.personName === "Cliente C"));
    assert.ok(!cf.largestProjectedInflows.some((r) => r.externalId === 3));
  });

  it("calendário CR previsto bate com série mensal do Fluxo", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200, dueDate: new Date(2026, 5, 10) }),
      arRow({ externalId: 2, balanceReceivable: 800, dueDate: new Date(2026, 5, 10) }),
    ];
    const filters = { ...BASE_CF_FILTERS, month: 6 };
    const cf = buildFinanceCashFlowDashboard(rows, [], filters, REF, arCutoff());
    assertAuditOk(auditCashFlowCalendarProjectedParity(cf), "calendar CR");
    const monthInflow = cf.calendar.days.reduce((s, d) => s + d.inflow, 0);
    assert.equal(monthInflow, 2000);
    assert.equal(cf.monthlySeries.find((p) => p.month === 6)!.inflowAmount, 2000);
  });
});

describe("financeCashFlowArApReconciliation — Contas a Pagar", () => {
  it("pagamentos vencidos do Fluxo batem com AP vencidos gerenciais", () => {
    const rows = [
      apRow({ externalId: 1, balancePayable: 900, dueDate: new Date(2026, 4, 1) }),
      apRow({ externalId: 2, balancePayable: 0, amountPaid: 900, paymentDate: new Date(2026, 5, 1) }),
      apRow({
        externalId: 3,
        companyName: "KOPPETEL",
        personName: "LAZARIOS",
        personCnpj: "12.345.678/0001-90",
        balancePayable: 7000,
        dueDate: new Date(2026, 3, 1),
      }),
      apRow({
        externalId: 4,
        type: 2,
        description: "PEDIDO DE COMPRA 123",
        balancePayable: 3000,
        dueDate: new Date(2026, 2, 1),
      }),
      apRow({ externalId: 5, syncedAt: STALE_SYNC, balancePayable: 4000, dueDate: new Date(2026, 1, 1) }),
    ];
    assertAuditOk(auditCashFlowApOverdueParityWithAp(rows, BASE_CF_FILTERS, REF, apCutoff(), arCutoff()), "AP overdue");

    const cf = buildFinanceCashFlowDashboard([], rows, BASE_CF_FILTERS, REF, null, apCutoff());
    assert.equal(cf.cards.overduePayableAmount, 900);
    assert.equal(cf.overduePayables.length, 1);
    assert.equal(cf.overduePayables[0]!.externalId, 1);
  });

  it("saídas previstas respeitam vencimento AP mesmo com scheduleDate posterior", () => {
    const rows = [
      apRow({
        externalId: 1,
        dueDate: new Date(2026, 5, 5),
        scheduleDate: new Date(2026, 7, 20),
        balancePayable: 2500,
      }),
    ];
    const jun = buildFinanceCashFlowDashboard([], rows, { ...BASE_CF_FILTERS, month: 6 }, REF, null, apCutoff());
    assert.equal(jun.cards.outflowAmount, 2500);
    const ago = buildFinanceCashFlowDashboard([], rows, { ...BASE_CF_FILTERS, month: 8 }, REF, null, apCutoff());
    assert.equal(ago.cards.outflowAmount, 0);
  });

  it("top fornecedores e maiores saídas usam portfólio AP aberto", () => {
    const rows = [
      apRow({ externalId: 1, personName: "Fornecedor A", balancePayable: 4000 }),
      apRow({ externalId: 2, personName: "Fornecedor B", balancePayable: 1000 }),
      apRow({ externalId: 3, type: 2, description: "PEDIDO DE COMPRA", balancePayable: 9000 }),
    ];
    assertAuditOk(
      auditCashFlowApProjectedListsParity(rows, BASE_CF_FILTERS, REF, apCutoff()),
      "AP lists"
    );
    const cf = buildFinanceCashFlowDashboard([], rows, BASE_CF_FILTERS, REF, null, apCutoff());
    assert.ok(!cf.largestProjectedOutflows.some((r) => r.externalId === 3));
  });

  it("calendário CP previsto bate com série mensal", () => {
    const rows = [
      apRow({ externalId: 1, balancePayable: 600, dueDate: new Date(2026, 5, 15) }),
      apRow({ externalId: 2, balancePayable: 400, dueDate: new Date(2026, 5, 15) }),
    ];
    const filters = { ...BASE_CF_FILTERS, month: 6 };
    const cf = buildFinanceCashFlowDashboard([], rows, filters, REF, null, apCutoff());
    assertAuditOk(auditCashFlowCalendarProjectedParity(cf), "calendar CP");
    assert.equal(cf.calendar.monthSummary.outflow, 1000);
  });
});

describe("financeCashFlowArApReconciliation — linha do tempo e cards", () => {
  it("linha do tempo executiva reconcilia inflow/outflow/net/acumulado", () => {
    const ar = [
      arRow({ externalId: 1, balanceReceivable: 1000, dueDate: new Date(2026, 5, 10) }),
      arRow({
        externalId: 2,
        balanceReceivable: 0,
        amountReceived: 500,
        settlementDate: new Date(2026, 5, 8),
        dueDate: new Date(2026, 5, 8),
      }),
    ];
    const ap = [apRow({ externalId: 3, balancePayable: 300, dueDate: new Date(2026, 5, 12) })];
    const cf = buildFinanceCashFlowDashboard(ar, ap, { ...BASE_CF_FILTERS, month: 6 }, REF, arCutoff(), apCutoff());
    assertAuditOk(auditCashFlowExecutiveTimelineInternal(cf), "timeline internal");
    assertAuditOk(auditCashFlowPeriodCardsParity(cf), "period cards");
  });

  it("carteira aberta e posição líquida batem com dashboards AR/AP", () => {
    const ar = [arRow({ externalId: 1, balanceReceivable: 5000 })];
    const ap = [apRow({ externalId: 2, balancePayable: 1200 })];
    assertAuditOk(
      auditCashFlowPortfolioOpenParityWithArAp(ar, ap, BASE_CF_FILTERS, REF, arCutoff(), apCutoff()),
      "portfolio open"
    );
    const cf = buildFinanceCashFlowDashboard(ar, ap, BASE_CF_FILTERS, REF, arCutoff(), apCutoff());
    assert.equal(cf.cards.netCashPosition, 3800);
    assert.equal(cf.reconciliation.receivable.matchesArOpen, true);
    assert.equal(cf.reconciliation.payable.matchesApOpen, true);
  });

  it("modo previsto: entradas/saídas do período batem com cross-module reconciliation", () => {
    const rec = reconcileFinanceModulesFromCashFlowFilters(
      [arRow({ externalId: 1, balanceReceivable: 3000, dueDate: new Date(2026, 5, 10) })],
      [apRow({ externalId: 2, balancePayable: 1100, dueDate: new Date(2026, 5, 12) })],
      { ...BASE_CF_FILTERS, month: 6 },
      REF
    );
    assert.equal(rec.status, "OK");
    assert.equal(rec.matches.projectedInflowVsArOpen, true);
    assert.equal(rec.matches.projectedOutflowVsApOpen, true);
  });
});

describe("financeCashFlowArApReconciliation — matriz de filtros", () => {
  const fixtureAr = [
    arRow({ externalId: 1, companyName: "Empresa A", balanceReceivable: 2000, dueDate: new Date(2026, 5, 5) }),
    arRow({
      externalId: 2,
      companyName: "Empresa B",
      balanceReceivable: 1500,
      dueDate: new Date(2026, 5, 20),
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
  ];
  const fixtureAp = [
    apRow({ externalId: 10, companyName: "Empresa A", balancePayable: 800, dueDate: new Date(2026, 5, 8) }),
    apRow({ externalId: 11, companyName: "Empresa B", balancePayable: 600, dueDate: new Date(2026, 5, 25) }),
  ];

  for (const { label, filters } of FILTER_MATRIX) {
    it(`relatório consolidado OK — filtro ${label}`, () => {
      const report = buildCashFlowArApReconciliationReport(
        fixtureAr,
        fixtureAp,
        filters,
        REF,
        arCutoff(),
        apCutoff()
      );
      assertAuditOk(report, `filter ${label}`);
    });
  }
});

describe("financeCashFlowArApReconciliation — stale AR/AP", () => {
  it("AR stale excluído do Fluxo e dos vencidos", () => {
    const rows = [
      arRow({ externalId: 1, syncedAt: LATEST_SYNC, balanceReceivable: 1000 }),
      arRow({ externalId: 2, syncedAt: STALE_SYNC, balanceReceivable: 8000, dueDate: new Date(2026, 1, 1) }),
    ];
    const cf = buildFinanceCashFlowDashboard(rows, [], BASE_CF_FILTERS, REF, arCutoff());
    assert.equal(cf.cards.overdueReceivableAmount, 1000);
    assert.ok(!cf.overdueReceivables.some((r) => r.externalId === 2));
  });

  it("AP stale excluído de pagamentos vencidos", () => {
    const rows = [
      apRow({ externalId: 1, syncedAt: LATEST_SYNC, balancePayable: 700, dueDate: new Date(2026, 4, 1) }),
      apRow({ externalId: 2, syncedAt: STALE_SYNC, balancePayable: 6000, dueDate: new Date(2026, 3, 1) }),
    ];
    const cf = buildFinanceCashFlowDashboard([], rows, BASE_CF_FILTERS, REF, null, apCutoff());
    assert.equal(cf.cards.overduePayableAmount, 700);
  });
});

describe("financeCashFlowArApReconciliation — sem hardcode", () => {
  const PRODUCTION_PATHS = [
    "src/lib/financeCashFlowDashboard.ts",
    "src/lib/financeCashFlowDataset.ts",
    "src/lib/financeCashFlowRowFilters.ts",
    "src/lib/financeCashFlowLedger.ts",
    "src/lib/financeCashFlowExecutiveSummary.ts",
    "src/lib/financeCashFlowCalendar.ts",
    "src/lib/financeAccountsReceivableDashboard.ts",
    "src/lib/financeAccountsReceivableOverdue.ts",
    "src/lib/financeAccountsPayableDashboard.ts",
    "src/lib/financeDashboardConsistencyAudit.ts",
    "src/lib/financeCashFlowArApReconciliation.ts",
  ];

  const FORBIDDEN = ["MEXICHEM", "MEXICHEN", "ENERGY", "ESMALTEC", "33.081.704", "98000", "18270"];

  it("motores de produção não usam hardcode por cliente/CNPJ/valor", () => {
    for (const rel of PRODUCTION_PATHS) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const token of FORBIDDEN) {
        assert.ok(!src.toUpperCase().includes(token), `${rel} contém ${token}`);
      }
    }
  });
});
