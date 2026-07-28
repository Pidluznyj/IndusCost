/**
 * Spotlight de centro de custo Matéria-prima no Fluxo de Caixa:
 * YTD + mês corrente + dois próximos meses (previsto por vencimento AP).
 *
 * Fonte: mesma série oficial de CC (monthlySeries.byCostCenter) usada na DRE,
 * filtrada pelo papel `raw_material`.
 */

import {
  DRE_COST_CENTER_ROLE_LABELS,
  resolveDreCostCenterRole,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import { roundMoney } from "@/src/lib/financeAccountsPayableDashboard.js";

export const FINANCE_CASH_FLOW_RAW_MATERIAL_MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export type FinanceCashFlowYearMonth = {
  year: number;
  month: number;
};

export type FinanceCashFlowRawMaterialMonthCard = {
  year: number;
  month: number;
  monthLabel: string;
  amount: number;
  kind: "current" | "forecast";
};

export type FinanceCashFlowRawMaterialSpotlight = {
  role: "raw_material";
  label: string;
  ytdYear: number;
  ytdThroughMonth: number;
  ytdThroughMonthLabel: string;
  ytdAmount: number;
  currentMonth: FinanceCashFlowRawMaterialMonthCard;
  nextMonths: [FinanceCashFlowRawMaterialMonthCard, FinanceCashFlowRawMaterialMonthCard];
  sourceNote: string;
};

export type FinanceCashFlowRawMaterialCcSpendRow = {
  month: number;
  year: number;
  costCenterId?: string;
  code: string;
  name: string;
  amount: number;
};

export function cashFlowMonthLabel(month: number): string {
  if (month < 1 || month > 12) return `Mês ${month}`;
  return FINANCE_CASH_FLOW_RAW_MATERIAL_MONTH_LABELS[month - 1]!;
}

export function addCashFlowCalendarMonths(
  ym: FinanceCashFlowYearMonth,
  delta: number
): FinanceCashFlowYearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function resolveRawMaterialSpotlightAnchor(
  referenceDate: Date
): FinanceCashFlowYearMonth {
  return {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
  };
}

/** Meses inclusos no YTD do ano selecionado, ancorados na data de referência. */
export function resolveRawMaterialYtdThroughMonth(
  ytdYear: number,
  anchor: FinanceCashFlowYearMonth
): number {
  if (ytdYear < anchor.year) return 12;
  if (ytdYear > anchor.year) return 0;
  return Math.min(12, Math.max(0, anchor.month));
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

/**
 * Agrega gasto mensal dos CCs classificados como Matéria-prima.
 */
export function aggregateRawMaterialMonthlySpend(
  rows: readonly FinanceCashFlowRawMaterialCcSpendRow[],
  mappingByCcId?: ReadonlyMap<string, DreCostCenterRole> | null
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.month < 1 || row.month > 12 || !Number.isFinite(row.amount)) continue;
    const role = resolveDreCostCenterRole(
      row.code,
      row.name,
      row.costCenterId,
      mappingByCcId
    );
    if (role !== "raw_material") continue;
    const key = monthKey(row.year, row.month);
    totals.set(key, (totals.get(key) ?? 0) + row.amount);
  }
  return totals;
}

function amountAt(
  totals: ReadonlyMap<string, number>,
  ym: FinanceCashFlowYearMonth
): number {
  return roundMoney(totals.get(monthKey(ym.year, ym.month)) ?? 0);
}

export function buildRawMaterialCostCenterSpotlight(input: {
  byCostCenter: readonly FinanceCashFlowRawMaterialCcSpendRow[];
  ytdYear: number;
  referenceDate: Date;
  mappingByCcId?: ReadonlyMap<string, DreCostCenterRole> | null;
}): FinanceCashFlowRawMaterialSpotlight {
  const anchor = resolveRawMaterialSpotlightAnchor(input.referenceDate);
  const next1 = addCashFlowCalendarMonths(anchor, 1);
  const next2 = addCashFlowCalendarMonths(anchor, 2);
  const totals = aggregateRawMaterialMonthlySpend(input.byCostCenter, input.mappingByCcId);
  const ytdThrough = resolveRawMaterialYtdThroughMonth(input.ytdYear, anchor);

  let ytdAmount = 0;
  for (let m = 1; m <= ytdThrough; m += 1) {
    ytdAmount += totals.get(monthKey(input.ytdYear, m)) ?? 0;
  }

  return {
    role: "raw_material",
    label: DRE_COST_CENTER_ROLE_LABELS.raw_material,
    ytdYear: input.ytdYear,
    ytdThroughMonth: ytdThrough,
    ytdThroughMonthLabel: ytdThrough > 0 ? cashFlowMonthLabel(ytdThrough) : "—",
    ytdAmount: roundMoney(ytdAmount),
    currentMonth: {
      year: anchor.year,
      month: anchor.month,
      monthLabel: cashFlowMonthLabel(anchor.month),
      amount: amountAt(totals, anchor),
      kind: "current",
    },
    nextMonths: [
      {
        year: next1.year,
        month: next1.month,
        monthLabel: cashFlowMonthLabel(next1.month),
        amount: amountAt(totals, next1),
        kind: "forecast",
      },
      {
        year: next2.year,
        month: next2.month,
        monthLabel: cashFlowMonthLabel(next2.month),
        amount: amountAt(totals, next2),
        kind: "forecast",
      },
    ],
    sourceNote:
      "Totais de Contas a Pagar alocados em centros de custo Matéria-prima (por vencimento).",
  };
}

export function emptyRawMaterialCostCenterSpotlight(
  referenceDate: Date,
  ytdYear: number
): FinanceCashFlowRawMaterialSpotlight {
  return buildRawMaterialCostCenterSpotlight({
    byCostCenter: [],
    ytdYear,
    referenceDate,
  });
}
