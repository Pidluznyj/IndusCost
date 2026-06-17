/**
 * Auditoria de paridade Fluxo de Caixa × Contas a Receber × Contas a Pagar.
 * Usa as mesmas bases saneadas e filtros equivalentes (portfolio vs período).
 */
import {
  buildFinanceAccountsReceivableDashboard,
  isFinanceArOverdueWithoutFiscalDocument,
  roundMoney,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { filterFinanceArManagementReportRows } from "./financeAccountsReceivableManagement.js";
import {
  buildFinanceAccountsPayableDashboard,
  filterFinanceApManagementReportRows,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { sumFinanceArOverdueOpenAmount } from "./financeAccountsReceivableOverdue.js";
import {
  buildFinanceCashFlowDashboard,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  filterCashFlowApPortfolioRows,
  filterCashFlowArPortfolioRows,
} from "./financeCashFlowRowFilters.js";
import {
  isFinanceCashFlowApOverdueRow,
  isFinanceCashFlowArOpenRow,
  isFinanceCashFlowArOverdueRow,
} from "./financeCashFlowDataset.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";
import { resolveFinanceApOpenAmount } from "./financeAccountsPayableRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

const EPSILON = 0.01;

export type FinanceCashFlowArApAuditResult = {
  ok: boolean;
  mismatches: string[];
};

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Filtros AR equivalentes ao portfólio do Fluxo (sem recorte de mês/ano). */
export function toCashFlowPortfolioArFilters(
  cfFilters: FinanceCashFlowDashboardFilters
): FinanceArDashboardFilters {
  const base = toArLoadFilters(cfFilters);
  return {
    ...base,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
}

/** Filtros AP equivalentes ao portfólio do Fluxo (sem recorte de mês/ano). */
export function toCashFlowPortfolioApFilters(
  cfFilters: FinanceCashFlowDashboardFilters
): FinanceApDashboardFilters {
  const base = toApLoadFilters(cfFilters);
  return {
    ...base,
    year: undefined,
    month: undefined,
    dueDateFrom: undefined,
    dueDateTo: undefined,
  };
}

function sumApOverdueOpenAmount(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): number {
  const scoped = filterFinanceApManagementReportRows(rows, { ...filters, status: "all" }, referenceDate, syncCutoff);
  return roundMoney(
    scoped
      .filter((row) => isFinanceCashFlowApOverdueRow(row as FinanceCashFlowApRow, referenceDate))
      .reduce((sum, row) => sum + resolveFinanceApOpenAmount(row), 0)
  );
}

function sumArPortfolioOpenAmount(
  rows: FinanceCashFlowArRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): number {
  const portfolio = filterCashFlowArPortfolioRows(
    rows,
    cfFilters,
    toArLoadFilters(cfFilters),
    referenceDate,
    syncCutoff
  );
  return roundMoney(
    portfolio
      .filter((row) => isFinanceCashFlowArOpenRow(row) && row.balanceReceivable > 0)
      .reduce((sum, row) => sum + row.balanceReceivable, 0)
  );
}

function sumApPortfolioOpenAmount(
  rows: FinanceCashFlowApRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): number {
  const portfolio = filterCashFlowApPortfolioRows(
    rows,
    cfFilters,
    toApLoadFilters(cfFilters),
    referenceDate,
    syncCutoff
  );
  return roundMoney(
    portfolio
      .filter((row) => resolveFinanceApOpenAmount(row) > 0)
      .reduce((sum, row) => sum + resolveFinanceApOpenAmount(row), 0)
  );
}

/** Vencidos a receber do Fluxo × total Atrasados AR (base portfólio saneada). */
export function auditCashFlowArOverdueParityWithAr(
  arRows: FinanceArDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  apRows: FinanceCashFlowApRow[] = []
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const portfolioFilters = toCashFlowPortfolioArFilters(cfFilters);
  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    apRows,
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const arOverdue = sumFinanceArOverdueOpenAmount(arRows, portfolioFilters, referenceDate, arSyncCutoff);

  if (!nearlyEqual(cf.cards.overdueReceivableAmount, arOverdue)) {
    mismatches.push(
      `overdueReceivableAmount fluxo=${cf.cards.overdueReceivableAmount} ar_atrasados=${arOverdue}`
    );
  }

  const listTotal = roundMoney(cf.overdueReceivables.reduce((s, r) => s + r.amount, 0));
  if (cf.overdueReceivables.length > 0 && listTotal > cf.cards.overdueReceivableAmount) {
    mismatches.push(
      `soma lista vencidos CR (${listTotal}) excede total (${cf.cards.overdueReceivableAmount})`
    );
  }

  const portfolioIds = new Set(
    filterCashFlowArPortfolioRows(
      arRows as FinanceCashFlowArRow[],
      cfFilters,
      toArLoadFilters(cfFilters),
      referenceDate,
      arSyncCutoff
    ).map((r) => r.externalId)
  );

  for (const item of cf.overdueReceivables) {
    if (!portfolioIds.has(item.externalId)) {
      mismatches.push(`vencido CR ${item.externalId} fora do portfólio saneado`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Pagamentos vencidos do Fluxo × AP vencidos gerenciais (base portfólio). */
export function auditCashFlowApOverdueParityWithAp(
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  arRows: FinanceCashFlowArRow[] = []
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const portfolioFilters = toCashFlowPortfolioApFilters(cfFilters);
  const cf = buildFinanceCashFlowDashboard(
    arRows,
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const apOverdue = sumApOverdueOpenAmount(apRows, portfolioFilters, referenceDate, apSyncCutoff);

  if (!nearlyEqual(cf.cards.overduePayableAmount, apOverdue)) {
    mismatches.push(
      `overduePayableAmount fluxo=${cf.cards.overduePayableAmount} ap_vencidos=${apOverdue}`
    );
  }

  const portfolioIds = new Set(
    filterCashFlowApPortfolioRows(
      apRows as FinanceCashFlowApRow[],
      cfFilters,
      toApLoadFilters(cfFilters),
      referenceDate,
      apSyncCutoff
    ).map((r) => r.externalId)
  );

  for (const item of cf.overduePayables) {
    if (!portfolioIds.has(item.externalId)) {
      mismatches.push(`vencido CP ${item.externalId} fora do portfólio saneado`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Carteira aberta e posição líquida × dashboards AR/AP (portfólio). */
export function auditCashFlowPortfolioOpenParityWithArAp(
  arRows: FinanceArDashboardRow[],
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const portfolioArFilters = toCashFlowPortfolioArFilters(cfFilters);
  const portfolioApFilters = toCashFlowPortfolioApFilters(cfFilters);

  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const arDash = buildFinanceAccountsReceivableDashboard(
    arRows,
    portfolioArFilters,
    referenceDate,
    arSyncCutoff
  );
  const apDash = buildFinanceAccountsPayableDashboard(
    apRows,
    portfolioApFilters,
    referenceDate,
    apSyncCutoff
  );

  if (!nearlyEqual(cf.cards.totalReceivableOpen, arDash.cards.totalOpenAmount)) {
    mismatches.push(
      `totalReceivableOpen fluxo=${cf.cards.totalReceivableOpen} ar=${arDash.cards.totalOpenAmount}`
    );
  }
  if (!nearlyEqual(cf.cards.totalPayableOpen, apDash.cards.totalOpenAmount)) {
    mismatches.push(
      `totalPayableOpen fluxo=${cf.cards.totalPayableOpen} ap=${apDash.cards.totalOpenAmount}`
    );
  }

  const periodArFilters = toArLoadFilters(cfFilters);
  const periodApFilters = toApLoadFilters(cfFilters);
  const arDashPeriod = buildFinanceAccountsReceivableDashboard(
    arRows,
    periodArFilters,
    referenceDate,
    arSyncCutoff
  );
  const apDashPeriod = buildFinanceAccountsPayableDashboard(
    apRows,
    periodApFilters,
    referenceDate,
    apSyncCutoff
  );
  if (!nearlyEqual(cf.reconciliation.receivable.arDashboardOpen, arDashPeriod.cards.totalOpenAmount)) {
    mismatches.push(
      `reconciliation.arDashboardOpen ${cf.reconciliation.receivable.arDashboardOpen} != ar período ${arDashPeriod.cards.totalOpenAmount}`
    );
  }
  if (!nearlyEqual(cf.reconciliation.payable.apDashboardOpen, apDashPeriod.cards.totalOpenAmount)) {
    mismatches.push(
      `reconciliation.apDashboardOpen ${cf.reconciliation.payable.apDashboardOpen} != ap período ${apDashPeriod.cards.totalOpenAmount}`
    );
  }
  if (!nearlyEqual(cf.reconciliation.receivable.cashFlowOpenPortfolio, cf.cards.totalReceivableOpen)) {
    mismatches.push("reconciliation.cashFlowOpenPortfolio diverge de cards.totalReceivableOpen");
  }
  if (!nearlyEqual(cf.reconciliation.payable.cashFlowOpenPortfolio, cf.cards.totalPayableOpen)) {
    mismatches.push("reconciliation.cashFlowOpenPortfolio diverge de cards.totalPayableOpen");
  }
  if (
    !nearlyEqual(
      cf.cards.netCashPosition,
      roundMoney(cf.cards.totalReceivableOpen - cf.cards.totalPayableOpen)
    )
  ) {
    mismatches.push("netCashPosition != totalReceivableOpen - totalPayableOpen");
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Maiores entradas / top clientes usam base de portfólio AR aberto. */
export function auditCashFlowArProjectedListsParity(
  arRows: FinanceArDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  apRows: FinanceCashFlowApRow[] = []
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    apRows,
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const portfolio = filterCashFlowArPortfolioRows(
    arRows as FinanceCashFlowArRow[],
    cfFilters,
    toArLoadFilters(cfFilters),
    referenceDate,
    arSyncCutoff
  );
  const openPortfolioIds = new Set(
    portfolio.filter((r) => isFinanceCashFlowArOpenRow(r) && r.balanceReceivable > 0).map((r) => r.externalId)
  );

  for (const item of [...cf.largestProjectedInflows, ...cf.overdueReceivables]) {
    if (!openPortfolioIds.has(item.externalId)) {
      mismatches.push(`entrada prevista ${item.externalId} fora do portfólio AR aberto`);
    }
  }

  const topTotal = roundMoney(cf.topCustomers.reduce((s, c) => s + c.amount, 0));
  const portfolioOpen = sumArPortfolioOpenAmount(
    arRows as FinanceCashFlowArRow[],
    cfFilters,
    referenceDate,
    arSyncCutoff
  );
  if (topTotal > portfolioOpen + EPSILON) {
    mismatches.push(`topCustomers (${topTotal}) excede carteira aberta (${portfolioOpen})`);
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Maiores saídas / top fornecedores usam base de portfólio AP aberto. */
export function auditCashFlowApProjectedListsParity(
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  apSyncCutoff?: NomusApReportSyncCutoff | null,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  arRows: FinanceCashFlowArRow[] = []
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const cf = buildFinanceCashFlowDashboard(
    arRows,
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const portfolio = filterCashFlowApPortfolioRows(
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    toApLoadFilters(cfFilters),
    referenceDate,
    apSyncCutoff
  );
  const openPortfolioIds = new Set(
    portfolio.filter((r) => resolveFinanceApOpenAmount(r) > 0).map((r) => r.externalId)
  );

  for (const item of [...cf.largestProjectedOutflows, ...cf.overduePayables]) {
    if (!openPortfolioIds.has(item.externalId)) {
      mismatches.push(`saída prevista ${item.externalId} fora do portfólio AP aberto`);
    }
  }

  const topTotal = roundMoney(cf.topSuppliers.reduce((s, c) => s + c.amount, 0));
  const portfolioOpen = sumApPortfolioOpenAmount(
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate,
    apSyncCutoff
  );
  if (topTotal > portfolioOpen + EPSILON) {
    mismatches.push(`topSuppliers (${topTotal}) excede carteira aberta (${portfolioOpen})`);
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** AR futuro sem NF entra em previsão; vencido sem NF não entra em portfólio/atraso. */
export function auditCashFlowArFiscalBackingParity(
  arRows: FinanceArDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    [],
    cfFilters,
    referenceDate,
    arSyncCutoff
  );
  const portfolio = filterCashFlowArPortfolioRows(
    arRows as FinanceCashFlowArRow[],
    cfFilters,
    toArLoadFilters(cfFilters),
    referenceDate,
    arSyncCutoff
  );
  const portfolioIds = new Set(portfolio.map((r) => r.externalId));

  for (const row of arRows) {
    if (!isFinanceArOverdueWithoutFiscalDocument(row, referenceDate)) continue;
    if (portfolioIds.has(row.externalId)) {
      mismatches.push(`vencido sem NF ${row.externalId} permanece no portfólio CR`);
    }
    if (cf.overdueReceivables.some((r) => r.externalId === row.externalId)) {
      mismatches.push(`vencido sem NF ${row.externalId} aparece em vencidos CR`);
    }
  }

  const eligible = filterFinanceArManagementReportRows(
    arRows,
    toCashFlowPortfolioArFilters(cfFilters),
    referenceDate,
    arSyncCutoff
  );
  for (const row of eligible) {
    if (!portfolioIds.has(row.externalId)) {
      mismatches.push(`título elegível ${row.externalId} ausente do portfólio CR`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Linha do tempo executiva: inflow/outflow/net/acumulado internamente consistentes. */
export function auditCashFlowExecutiveTimelineInternal(
  payload: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  let expectedAccum = 0;

  for (const row of payload.executiveSummary.monthlyTimeline) {
    const expectedInflow = roundMoney(row.received + row.receivableOpenDue);
    const expectedOutflow = roundMoney(row.paid + row.payableOpenDue);
    const expectedNet = roundMoney(expectedInflow - expectedOutflow);
    expectedAccum = roundMoney(expectedAccum + expectedNet);

    if (!nearlyEqual(row.estimatedInflow, expectedInflow)) {
      mismatches.push(`timeline m${row.month} estimatedInflow`);
    }
    if (!nearlyEqual(row.estimatedOutflow, expectedOutflow)) {
      mismatches.push(`timeline m${row.month} estimatedOutflow`);
    }
    if (!nearlyEqual(row.netFlow, expectedNet)) {
      mismatches.push(`timeline m${row.month} netFlow`);
    }
    if (!nearlyEqual(row.accumulatedNet, expectedAccum)) {
      mismatches.push(`timeline m${row.month} accumulatedNet`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Cards do período × série mensal × conferência ledger (modo previsto). */
export function auditCashFlowPeriodCardsParity(
  payload: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const { cards, executiveSummary, monthlySeries, reconciliation } = payload;

  if (!nearlyEqual(cards.netFlowAmount, roundMoney(cards.inflowAmount - cards.outflowAmount))) {
    mismatches.push("cards.netFlowAmount != inflow - outflow");
  }
  if (!nearlyEqual(executiveSummary.period.netFlowAmount, cards.netFlowAmount)) {
    mismatches.push("executiveSummary.period.netFlowAmount != cards.netFlowAmount");
  }
  if (!nearlyEqual(executiveSummary.period.inflowAmount, cards.inflowAmount)) {
    mismatches.push("executiveSummary.period.inflowAmount != cards.inflowAmount");
  }
  if (!nearlyEqual(executiveSummary.period.outflowAmount, cards.outflowAmount)) {
    mismatches.push("executiveSummary.period.outflowAmount != cards.outflowAmount");
  }
  if (!reconciliation.netMatchesLedger) {
    mismatches.push("reconciliation.netMatchesLedger false");
  }
  if (!reconciliation.receivable.matchesLedger) {
    mismatches.push("reconciliation.receivable.matchesLedger false");
  }
  if (!reconciliation.payable.matchesLedger) {
    mismatches.push("reconciliation.payable.matchesLedger false");
  }

  const seriesInflow = roundMoney(
    monthlySeries.reduce((s, p) => s + (p.inflowAmount ?? 0), 0)
  );
  const seriesOutflow = roundMoney(
    monthlySeries.reduce((s, p) => s + (p.outflowAmount ?? 0), 0)
  );
  if (payload.filtersApplied.viewMode === "projected") {
    if (!nearlyEqual(seriesInflow, cards.inflowAmount)) {
      mismatches.push(`monthlySeries inflow ${seriesInflow} != cards ${cards.inflowAmount}`);
    }
    if (!nearlyEqual(seriesOutflow, cards.outflowAmount)) {
      mismatches.push(`monthlySeries outflow ${seriesOutflow} != cards ${cards.outflowAmount}`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Calendário previsto × série do mês (CR/CP). */
export function auditCashFlowCalendarProjectedParity(
  payload: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  if (payload.filtersApplied.viewMode === "realized") {
    return { ok: true, mismatches: [] };
  }

  const monthInflow = roundMoney(payload.calendar.days.reduce((s, d) => s + d.inflow, 0));
  const monthOutflow = roundMoney(payload.calendar.days.reduce((s, d) => s + d.outflow, 0));

  if (!nearlyEqual(monthInflow, payload.calendar.monthSummary.inflow)) {
    mismatches.push("calendário inflow dias != monthSummary");
  }
  if (!nearlyEqual(monthOutflow, payload.calendar.monthSummary.outflow)) {
    mismatches.push("calendário outflow dias != monthSummary");
  }

  const filterMonth = payload.filtersApplied.month;
  if (filterMonth != null) {
    const point = payload.monthlySeries.find((p) => p.month === filterMonth);
    if (point && point.inflowAmount != null && !nearlyEqual(monthInflow, point.inflowAmount)) {
      mismatches.push(
        `calendário inflow ${monthInflow} != monthlySeries m${filterMonth} ${point.inflowAmount}`
      );
    }
    if (point && point.outflowAmount != null && !nearlyEqual(monthOutflow, point.outflowAmount)) {
      mismatches.push(
        `calendário outflow ${monthOutflow} != monthlySeries m${filterMonth} ${point.outflowAmount}`
      );
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** AP aberto usa data operacional (scheduleDate > dueDate). */
export function auditCashFlowApOperationalDateParity(
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowArApAuditResult {
  const mismatches: string[] = [];
  const row = apRows[0];
  if (!row) return { ok: true, mismatches: [] };

  const operational = getAccountsPayableOperationalDueDate(row);
  const cf = buildFinanceCashFlowDashboard([], apRows as FinanceCashFlowApRow[], cfFilters, referenceDate, null, apSyncCutoff);

  if (cfFilters.month != null && operational) {
    const inMonth = operational.getMonth() + 1 === cfFilters.month;
    const inPortfolio = cf.largestProjectedOutflows.some((r) => r.externalId === row.externalId);
    if (!inMonth && inPortfolio && cfFilters.viewMode === "projected") {
      mismatches.push(
        `AP ${row.externalId} com data operacional fora do mês filtrado apareceu em saídas previstas`
      );
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Relatório consolidado de paridade para uma fixture. */
export function buildCashFlowArApReconciliationReport(
  arRows: FinanceArDashboardRow[],
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  arSyncCutoff?: NomusArReportSyncCutoff | null,
  apSyncCutoff?: NomusApReportSyncCutoff | null
): FinanceCashFlowArApAuditResult {
  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );
  const parts = [
    auditCashFlowArOverdueParityWithAr(arRows, cfFilters, referenceDate, arSyncCutoff, apSyncCutoff, apRows as FinanceCashFlowApRow[]),
    auditCashFlowApOverdueParityWithAp(apRows, cfFilters, referenceDate, apSyncCutoff, arSyncCutoff, arRows as FinanceCashFlowArRow[]),
    auditCashFlowPortfolioOpenParityWithArAp(arRows, apRows, cfFilters, referenceDate, arSyncCutoff, apSyncCutoff),
    auditCashFlowArProjectedListsParity(arRows, cfFilters, referenceDate, arSyncCutoff, apSyncCutoff, apRows as FinanceCashFlowApRow[]),
    auditCashFlowApProjectedListsParity(apRows, cfFilters, referenceDate, apSyncCutoff, arSyncCutoff, arRows as FinanceCashFlowArRow[]),
    auditCashFlowArFiscalBackingParity(arRows, cfFilters, referenceDate, arSyncCutoff),
    auditCashFlowExecutiveTimelineInternal(cf),
    auditCashFlowPeriodCardsParity(cf),
    auditCashFlowCalendarProjectedParity(cf),
  ];
  const mismatches = parts.flatMap((p) => p.mismatches);
  return { ok: mismatches.length === 0, mismatches };
}
