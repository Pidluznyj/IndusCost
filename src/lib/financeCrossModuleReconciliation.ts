import { buildOfficialAccountsReceivableDashboard } from "./financeAccountsReceivableRulesAdapter.js";
import {
  roundMoney,
  type FinanceArDashboardRow,
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  computeCashFlowLedgerPeriodTotals,
  resolveCashFlowArAmount,
  resolveCashFlowApAmount,
  shouldIncludeCashFlowArMovement,
  shouldIncludeCashFlowApMovement,
  resolveCashFlowArMovementDate,
  resolveCashFlowApMovementDate,
} from "./financeCashFlowLedger.js";
import {
  filterCashFlowArRowsScoped,
  filterCashFlowApRowsScoped,
} from "./financeCashFlowRowFilters.js";

const EPSILON = 0.01;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export type FinanceCrossModuleReconciliation = {
  periodLabel: string;
  viewMode: FinanceCashFlowDashboardFilters["viewMode"];
  invoiceIssued: FinanceCashFlowDashboardFilters["invoiceIssued"];
  ar: {
    totalOpenAmount: number;
    openWithInvoiceAmount: number;
    openWithoutInvoiceAmount: number;
    realizedInPeriod: number;
  };
  ap: {
    totalOpenAmount: number;
    realizedInPeriod: number;
  };
  cashFlow: {
    inflowAmount: number;
    outflowAmount: number;
    netFlowAmount: number;
  };
  matches: {
    projectedInflowVsArOpen: boolean;
    projectedOutflowVsApOpen: boolean;
    realizedInflowVsAr: boolean;
    realizedOutflowVsAp: boolean;
    netVsComponents: boolean;
  };
  deltas: {
    inflowVsAr: number;
    outflowVsAp: number;
  };
  status: "OK" | "DIVERGENCE";
  notes: string[];
};

function periodLabel(filters: FinanceCashFlowDashboardFilters): string {
  if (filters.year != null && filters.month != null) {
    return `${String(filters.month).padStart(2, "0")}/${filters.year}`;
  }
  if (filters.year != null) return `Ano ${filters.year}`;
  return "Período filtrado";
}

function computeArRealizedInPeriod(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): number {
  const scoped = filterCashFlowArRowsScoped(
    rows as FinanceCashFlowArRow[],
    cfFilters,
    filters,
    referenceDate
  );
  let total = 0;
  for (const row of scoped) {
    if (!shouldIncludeCashFlowArMovement(row, "realized")) continue;
    const amount = resolveCashFlowArAmount(row, "realized");
    if (amount <= 0) continue;
    const date = resolveCashFlowArMovementDate(row, "realized", cfFilters.dateBase);
    if (!date) continue;
    const bounds = {
      seriesYear: cfFilters.year ?? referenceDate.getFullYear(),
      month: cfFilters.month,
    };
    if (date.getFullYear() !== bounds.seriesYear) continue;
    if (bounds.month != null && date.getMonth() + 1 !== bounds.month) continue;
    total += amount;
  }
  return roundMoney(total);
}

function computeApRealizedInPeriod(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): number {
  const scoped = filterCashFlowApRowsScoped(
    rows as FinanceCashFlowApRow[],
    cfFilters,
    filters,
    referenceDate
  );
  let total = 0;
  for (const row of scoped) {
    if (!shouldIncludeCashFlowApMovement(row, "realized")) continue;
    const amount = resolveCashFlowApAmount(row, "realized");
    if (amount <= 0) continue;
    const date = resolveCashFlowApMovementDate(row, "realized", cfFilters.dateBase);
    if (!date) continue;
    const bounds = {
      seriesYear: cfFilters.year ?? referenceDate.getFullYear(),
      month: cfFilters.month,
    };
    if (date.getFullYear() !== bounds.seriesYear) continue;
    if (bounds.month != null && date.getMonth() + 1 !== bounds.month) continue;
    total += amount;
  }
  return roundMoney(total);
}

/** Concilia AR, AP e Fluxo de Caixa com os mesmos filtros e saneamento. */
export function buildFinanceCrossModuleReconciliation(
  arRows: FinanceArDashboardRow[],
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  arFilters: FinanceArDashboardFilters,
  apFilters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
): FinanceCrossModuleReconciliation {
  const arDash = buildOfficialAccountsReceivableDashboard({
    rows: arRows,
    filters: arFilters,
    referenceDate,
  });
  const apDash = buildFinanceAccountsPayableDashboard(apRows, apFilters, referenceDate);
  const cf = buildFinanceCashFlowDashboard(
    arRows as FinanceCashFlowArRow[],
    apRows as FinanceCashFlowApRow[],
    cfFilters,
    referenceDate
  );
  const ledger = computeCashFlowLedgerPeriodTotals(
    filterCashFlowArRowsScoped(
      arRows as FinanceCashFlowArRow[],
      cfFilters,
      arFilters,
      referenceDate
    ),
    filterCashFlowApRowsScoped(
      apRows as FinanceCashFlowApRow[],
      cfFilters,
      apFilters,
      referenceDate
    ),
    cfFilters,
    referenceDate
  );

  const arRealized = computeArRealizedInPeriod(arRows, arFilters, cfFilters, referenceDate);
  const apRealized = computeApRealizedInPeriod(apRows, apFilters, cfFilters, referenceDate);

  const projectedInflowVsArOpen =
    cfFilters.viewMode !== "projected" ||
    nearlyEqual(cf.cards.inflowAmount, arDash.cards.totalOpenAmount);
  const projectedOutflowVsApOpen =
    cfFilters.viewMode !== "projected" ||
    nearlyEqual(cf.cards.outflowAmount, apDash.cards.totalOpenAmount);

  const inflowCompare =
    cfFilters.viewMode === "realized"
      ? arRealized
      : cfFilters.viewMode === "projected"
        ? arDash.cards.totalOpenAmount
        : ledger.inflow;
  const outflowCompare =
    cfFilters.viewMode === "realized"
      ? apRealized
      : cfFilters.viewMode === "projected"
        ? apDash.cards.totalOpenAmount
        : ledger.outflow;

  const realizedInflowVsAr =
    cfFilters.viewMode !== "realized" ||
    nearlyEqual(cf.cards.inflowAmount, arRealized);
  const realizedOutflowVsAp =
    cfFilters.viewMode !== "realized" ||
    nearlyEqual(cf.cards.outflowAmount, apRealized);
  const netVsComponents = nearlyEqual(
    cf.cards.netFlowAmount,
    roundMoney(cf.cards.inflowAmount - cf.cards.outflowAmount)
  );

  const notes = [
    "Faturamento (NF-e) não entra no fluxo — apenas Contas a Receber e Contas a Pagar saneados.",
    "Previsto: saldo em aberto por vencimento. Realizado: valor liquidado por data de baixa/pagamento.",
    "Recebíveis sem NF substituídos por versão com NF não entram no total (deduplicação).",
  ];

  if (cfFilters.invoiceIssued === "yes") {
    notes.push("Origem Com NF: somente títulos com NF vinculada.");
  } else if (cfFilters.invoiceIssued === "no") {
    notes.push("Origem Sem NF: somente títulos sem NF e não substituídos.");
  }

  const combinedLedgerOk =
    cfFilters.viewMode !== "combined" ||
    (nearlyEqual(cf.cards.inflowAmount, ledger.inflow) &&
      nearlyEqual(cf.cards.outflowAmount, ledger.outflow));

  const status =
    projectedInflowVsArOpen &&
    projectedOutflowVsApOpen &&
    realizedInflowVsAr &&
    realizedOutflowVsAp &&
    netVsComponents &&
    combinedLedgerOk
      ? "OK"
      : "DIVERGENCE";

  return {
    periodLabel: periodLabel(cfFilters),
    viewMode: cfFilters.viewMode,
    invoiceIssued: cfFilters.invoiceIssued,
    ar: {
      totalOpenAmount: arDash.cards.totalOpenAmount,
      openWithInvoiceAmount: arDash.cards.openWithInvoiceAmount,
      openWithoutInvoiceAmount: arDash.cards.openWithoutInvoiceAmount,
      realizedInPeriod: arRealized,
    },
    ap: {
      totalOpenAmount: apDash.cards.totalOpenAmount,
      realizedInPeriod: apRealized,
    },
    cashFlow: {
      inflowAmount: cf.cards.inflowAmount,
      outflowAmount: cf.cards.outflowAmount,
      netFlowAmount: cf.cards.netFlowAmount,
    },
    matches: {
      projectedInflowVsArOpen,
      projectedOutflowVsApOpen,
      realizedInflowVsAr,
      realizedOutflowVsAp,
      netVsComponents,
    },
    deltas: {
      inflowVsAr: roundMoney(cf.cards.inflowAmount - inflowCompare),
      outflowVsAp: roundMoney(cf.cards.outflowAmount - outflowCompare),
    },
    status,
    notes,
  };
}

/** Atalho para testes: usa filtros derivados do fluxo. */
export function reconcileFinanceModulesFromCashFlowFilters(
  arRows: FinanceArDashboardRow[],
  apRows: FinanceApDashboardRow[],
  cfFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date = new Date()
): FinanceCrossModuleReconciliation {
  return buildFinanceCrossModuleReconciliation(
    arRows,
    apRows,
    cfFilters,
    toArLoadFilters(cfFilters),
    toApLoadFilters(cfFilters),
    referenceDate
  );
}
