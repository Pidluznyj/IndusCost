/**
 * Regras únicas de movimentação de caixa a partir de Contas a Receber e Contas a Pagar.
 * Usado pelo dashboard, previsão, calendário e reconciliação com AR/AP.
 */
import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";
import {
  isFinanceCashFlowApOpenRow,
  isFinanceCashFlowArOpenRow,
  type FinanceCashFlowDatasetBlocks,
} from "./financeCashFlowDataset.js";
import {
  isFinanceApCancelledTitle,
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
  FINANCE_AP_CASH_FLOW_RULES_NOTE,
} from "./financeAccountsPayableRules.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type {
  FinanceCashFlowDateBase,
  FinanceCashFlowReconciliation,
  FinanceCashFlowViewMode,
} from "./financeCashFlowDashboardTypes.js";

export type CashFlowMovementSlice = "projected" | "realized";

export function cashFlowViewModeSlices(
  viewMode: FinanceCashFlowViewMode
): CashFlowMovementSlice[] {
  if (viewMode === "combined") return ["projected", "realized"];
  if (viewMode === "realized") return ["realized"];
  return ["projected"];
}

/** Slices do calendário diário — Previsto inclui realizado + aberto (Entradas/Saídas est.). */
export function calendarCashFlowMovementSlices(
  viewMode: FinanceCashFlowViewMode
): CashFlowMovementSlice[] {
  if (viewMode === "realized") return ["realized"];
  if (viewMode === "combined") return ["projected", "realized"];
  return ["realized", "projected"];
}

/** Alinha CP realizado do calendário com a linha do tempo executiva (dueDate). */
export function shouldIncludeCalendarApRealizedMovement(
  row: FinanceCashFlowApRow
): boolean {
  if (isFinanceApCancelledTitle(row)) return false;
  return resolveFinanceApRealizedAmount(row) > 0 && row.dueDate != null;
}

export function resolveCalendarApRealizedMovementDate(
  row: FinanceCashFlowApRow
): Date | null {
  return row.dueDate ?? null;
}

/** Previsto/Realizado no Fluxo planejado: sempre aloca pelo vencimento (dueDate). */
export function resolveCashFlowArMovementDate(
  row: FinanceCashFlowArRow,
  slice: CashFlowMovementSlice,
  dateBase: FinanceCashFlowDateBase
): Date | null {
  // Fluxo de Caixa planejado: sempre aloca pelo vencimento (dueDate),
  // independentemente de modo (previsto/realizado) ou filtros de auditoria.
  return row.dueDate ?? null;
}

/** Previsto/Realizado no Fluxo planejado: sempre aloca AP pelo vencimento (dueDate). */
export function resolveCashFlowApMovementDate(
  row: FinanceCashFlowApRow,
  _slice: CashFlowMovementSlice,
  _dateBase: FinanceCashFlowDateBase
): Date | null {
  return row.dueDate ?? null;
}

export function resolveCashFlowArAmount(
  row: FinanceCashFlowArRow,
  slice: CashFlowMovementSlice
): number {
  if (slice === "projected") {
    if (!isFinanceCashFlowArOpenRow(row) || row.suspendCollection) return 0;
    return row.balanceReceivable;
  }
  return row.amountReceived > 0 ? row.amountReceived : 0;
}

export function resolveCashFlowApAmount(
  row: FinanceCashFlowApRow,
  slice: CashFlowMovementSlice
): number {
  if (slice === "projected") {
    if (!isFinanceApOpen(row) || row.suspendPayment) return 0;
    return resolveFinanceApOpenAmount(row);
  }
  return resolveFinanceApRealizedAmount(row);
}

export function shouldIncludeCashFlowArMovement(
  row: FinanceCashFlowArRow,
  slice: CashFlowMovementSlice
): boolean {
  if (slice === "projected") {
    return isFinanceCashFlowArOpenRow(row) && row.balanceReceivable > 0;
  }
  return row.amountReceived > 0 && row.dueDate != null;
}

export function shouldIncludeCashFlowApMovement(
  row: FinanceCashFlowApRow,
  slice: CashFlowMovementSlice
): boolean {
  if (isFinanceApCancelledTitle(row)) return false;
  if (slice === "projected") {
    return isFinanceApOpen(row) && !row.suspendPayment && resolveFinanceApOpenAmount(row) > 0;
  }
  const realized = resolveFinanceApRealizedAmount(row);
  return realized > 0 && row.dueDate != null;
}

export type CashFlowPeriodBounds = {
  seriesYear: number;
  month?: number;
};

export function resolveCashFlowPeriodBounds(
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): CashFlowPeriodBounds {
  return {
    seriesYear: filters.year ?? referenceDate.getFullYear(),
    month: filters.month,
  };
}

function movementMatchesPeriod(
  date: Date,
  bounds: CashFlowPeriodBounds
): boolean {
  if (date.getFullYear() !== bounds.seriesYear) return false;
  if (bounds.month != null && date.getMonth() + 1 !== bounds.month) return false;
  return true;
}

export type CashFlowLedgerPeriodTotals = {
  inflow: number;
  outflow: number;
  net: number;
  inflowCount: number;
  outflowCount: number;
};

/** Soma entradas/saídas do período com as mesmas regras da série mensal. */
export function computeCashFlowLedgerPeriodTotals(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): CashFlowLedgerPeriodTotals {
  const bounds = resolveCashFlowPeriodBounds(filters, referenceDate);
  let inflow = 0;
  let outflow = 0;
  let inflowCount = 0;
  let outflowCount = 0;

  for (const slice of cashFlowViewModeSlices(filters.viewMode)) {
    for (const row of arRows) {
      if (!shouldIncludeCashFlowArMovement(row, slice)) continue;
      const amount = resolveCashFlowArAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
      if (!date || !movementMatchesPeriod(date, bounds)) continue;
      inflow += amount;
      inflowCount += 1;
    }

    for (const row of apRows) {
      if (!shouldIncludeCashFlowApMovement(row, slice)) continue;
      const amount = resolveCashFlowApAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
      if (!date || !movementMatchesPeriod(date, bounds)) continue;
      outflow += amount;
      outflowCount += 1;
    }
  }

  const inflowRounded = roundMoney(inflow);
  const outflowRounded = roundMoney(outflow);
  return {
    inflow: inflowRounded,
    outflow: outflowRounded,
    net: roundMoney(inflowRounded - outflowRounded),
    inflowCount,
    outflowCount,
  };
}

export type CashFlowOpenPortfolioTotals = {
  receivableOpen: number;
  payableOpen: number;
  netPosition: number;
};

export function portfolioTotalsFromDatasetBlocks(
  blocks: FinanceCashFlowDatasetBlocks
): CashFlowOpenPortfolioTotals {
  return {
    receivableOpen: blocks.totalReceivableOpen,
    payableOpen: blocks.totalPayableOpen,
    netPosition: roundMoney(blocks.totalReceivableOpen - blocks.totalPayableOpen),
  };
}

/** Soma carteira aberta com as mesmas regras de buildBlocksFromPortfolio. */
export function computeCashFlowOpenPortfolioTotals(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[]
): CashFlowOpenPortfolioTotals {
  let receivableOpen = 0;
  let payableOpen = 0;

  for (const row of arRows) {
    if (!isFinanceCashFlowArOpenRow(row)) continue;
    const balance = roundMoney(row.balanceReceivable);
    if (balance <= 0) continue;
    receivableOpen += balance;
  }
  for (const row of apRows) {
    if (!isFinanceCashFlowApOpenRow(row)) continue;
    const openAmount = roundMoney(resolveFinanceApOpenAmount(row));
    if (openAmount <= 0) continue;
    payableOpen += openAmount;
  }

  const receivableRounded = roundMoney(receivableOpen);
  const payableRounded = roundMoney(payableOpen);
  return {
    receivableOpen: receivableRounded,
    payableOpen: payableRounded,
    netPosition: roundMoney(receivableRounded - payableRounded),
  };
}

function buildPeriodLabel(filters: FinanceCashFlowDashboardFilters): string {
  if (filters.year != null && filters.month != null) {
    return `${String(filters.month).padStart(2, "0")}/${filters.year}`;
  }
  if (filters.year != null) return `Ano ${filters.year}`;
  return "Período filtrado";
}

function viewModeLabel(viewMode: FinanceCashFlowViewMode): string {
  if (viewMode === "realized") return "Realizado";
  if (viewMode === "combined") return "Realizado + Previsto";
  return "Previsto";
}

const EPSILON = 0.01;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export type CashFlowReconciliationSourceTotals = {
  /** Carteira aberta AR — escopo portfólio (sem mês/ano). */
  arDashboardOpenPortfolio: number;
  /** Carteira aberta AR — escopo período (filtro ano/mês). */
  arDashboardOpenPeriod: number;
  /** Carteira aberta AP — escopo portfólio. */
  apDashboardOpenPortfolio: number;
  /** Carteira aberta AP — escopo período. */
  apDashboardOpenPeriod: number;
  arDashboardReceived: number;
  apDashboardPaid: number;
};

/**
 * Conferência entre Fluxo de Caixa, ledger e dashboards AR/AP (mesmos filtros e saneamento).
 */
export function buildCashFlowReconciliation(
  filters: FinanceCashFlowDashboardFilters,
  cashFlow: {
    inflowAmount: number;
    outflowAmount: number;
    netFlowAmount: number;
    totalReceivableOpen: number;
    totalPayableOpen: number;
  },
  ledgerPeriod: CashFlowLedgerPeriodTotals,
  portfolio: CashFlowOpenPortfolioTotals,
  sourceTotals: CashFlowReconciliationSourceTotals,
  options?: { openReceivableWithoutDueDate?: number }
): FinanceCashFlowReconciliation {

  const inflowMatchesLedger = nearlyEqual(cashFlow.inflowAmount, ledgerPeriod.inflow);
  const outflowMatchesLedger = nearlyEqual(cashFlow.outflowAmount, ledgerPeriod.outflow);
  const netMatchesLedger = nearlyEqual(cashFlow.netFlowAmount, ledgerPeriod.net);

  const openMatchesAr = nearlyEqual(
    cashFlow.totalReceivableOpen,
    sourceTotals.arDashboardOpenPortfolio
  );
  const openMatchesAp = nearlyEqual(
    cashFlow.totalPayableOpen,
    sourceTotals.apDashboardOpenPortfolio
  );
  const portfolioMatchesAr = nearlyEqual(
    portfolio.receivableOpen,
    sourceTotals.arDashboardOpenPortfolio
  );
  const portfolioMatchesAp = nearlyEqual(
    portfolio.payableOpen,
    sourceTotals.apDashboardOpenPortfolio
  );

  const notes: string[] = [
    "Entradas = Contas a Receber (NomusAccountsReceivable). Saídas = Contas a Pagar (NomusAccountsPayable).",
    "Saldo líquido do período = entradas − saídas (valores financeiros, não quantidade de títulos).",
    `Modo ${viewModeLabel(filters.viewMode)}: previsto usa saldo em aberto e vencimento; realizado usa valor liquidado e data de baixa/pagamento.`,
    FINANCE_AP_CASH_FLOW_RULES_NOTE,
    "Faturamento não alimenta este fluxo — apenas AR/AP saneados.",
  ];

  if (filters.invoiceIssued === "yes") {
    notes.push("Origem do recebível: somente títulos com NF vinculada.");
  } else if (filters.invoiceIssued === "no") {
    notes.push("Origem do recebível: somente títulos sem NF vinculada.");
  }

  if (!inflowMatchesLedger || !outflowMatchesLedger) {
    notes.push(
      "Divergência interna entre cards do fluxo e recomputação do ledger — revisar série mensal."
    );
  }

  if (!openMatchesAr) {
    notes.push(
      `Carteira a receber: fluxo R$ ${cashFlow.totalReceivableOpen.toFixed(2)} vs AR Em Aberto (portfólio) R$ ${sourceTotals.arDashboardOpenPortfolio.toFixed(2)}.`
    );
  }
  if (!openMatchesAp) {
    notes.push(
      `Carteira a pagar: fluxo R$ ${cashFlow.totalPayableOpen.toFixed(2)} vs AP Em Aberto (portfólio) R$ ${sourceTotals.apDashboardOpenPortfolio.toFixed(2)}.`
    );
  }
  if (
    !nearlyEqual(
      sourceTotals.arDashboardOpenPeriod,
      sourceTotals.arDashboardOpenPortfolio
    )
  ) {
    notes.push(
      `AR em aberto: portfólio R$ ${sourceTotals.arDashboardOpenPortfolio.toFixed(2)} vs período R$ ${sourceTotals.arDashboardOpenPeriod.toFixed(2)}.`
    );
  }
  if (
    !nearlyEqual(
      sourceTotals.apDashboardOpenPeriod,
      sourceTotals.apDashboardOpenPortfolio
    )
  ) {
    notes.push(
      `AP em aberto: portfólio R$ ${sourceTotals.apDashboardOpenPortfolio.toFixed(2)} vs período R$ ${sourceTotals.apDashboardOpenPeriod.toFixed(2)}.`
    );
  }

  if (filters.viewMode === "realized") {
    notes.push(
      "No modo realizado, entradas e recebidos são alocados pelo vencimento (dueDate). settlementDate permanece apenas para auditoria operacional."
    );
  }

  if (filters.viewMode === "projected" || filters.viewMode === "combined") {
    const openWithoutDue = options?.openReceivableWithoutDueDate ?? 0;
    if (openWithoutDue > 0) {
      notes.push(
        `${openWithoutDue} título(s) em aberto sem vencimento entram na carteira AR mas não no fluxo do período.`
      );
    }
  }

  return {
    periodLabel: buildPeriodLabel(filters),
    viewMode: filters.viewMode,
    receivable: {
      cashFlowInflow: cashFlow.inflowAmount,
      ledgerInflow: ledgerPeriod.inflow,
      arDashboardOpen: sourceTotals.arDashboardOpenPeriod,
      arDashboardReceived: sourceTotals.arDashboardReceived,
      cashFlowOpenPortfolio: cashFlow.totalReceivableOpen,
      matchesLedger: inflowMatchesLedger,
      matchesArOpen: openMatchesAr && portfolioMatchesAr,
      deltaVsLedger: roundMoney(cashFlow.inflowAmount - ledgerPeriod.inflow),
      deltaOpenVsAr: roundMoney(
        cashFlow.totalReceivableOpen - sourceTotals.arDashboardOpenPortfolio
      ),
    },
    payable: {
      cashFlowOutflow: cashFlow.outflowAmount,
      ledgerOutflow: ledgerPeriod.outflow,
      apDashboardOpen: sourceTotals.apDashboardOpenPeriod,
      apDashboardPaid: sourceTotals.apDashboardPaid,
      cashFlowOpenPortfolio: cashFlow.totalPayableOpen,
      matchesLedger: outflowMatchesLedger,
      matchesApOpen: openMatchesAp && portfolioMatchesAp,
      deltaVsLedger: roundMoney(cashFlow.outflowAmount - ledgerPeriod.outflow),
      deltaOpenVsAp: roundMoney(
        cashFlow.totalPayableOpen - sourceTotals.apDashboardOpenPortfolio
      ),
    },
    netCashFlow: cashFlow.netFlowAmount,
    netMatchesLedger,
    notes,
  };
}
