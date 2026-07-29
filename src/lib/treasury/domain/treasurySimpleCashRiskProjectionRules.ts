/**
 * Domínio — projeção simples de risco de caixa (Próximos dias).
 * Reusa motor/agenda existentes; sem segundo motor de fluxo.
 */

import type {
  TreasuryAgendaDayDto,
  TreasuryProjectionCompositionItemDto,
} from "../contracts/treasuryDto.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  treasuryMoneyFromCents,
  treasuryMoneyToCents,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  findFirstNegativeCivilDate,
  findMinimumClosingBalance,
} from "./treasuryProjectionComparisonRules.js";

export const TREASURY_SIMPLE_CASH_RISK_TITLE = "Fluxo Gerencial" as const;

export const TREASURY_SIMPLE_CASH_RISK_UI_PATH =
  "/finance/treasury/projection" as const;

export const TREASURY_SIMPLE_CASH_RISK_PERIODS = [
  "7d",
  "30d",
  "60d",
  "90d",
] as const;
export type TreasurySimpleCashRiskPeriod =
  (typeof TREASURY_SIMPLE_CASH_RISK_PERIODS)[number];

export const TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS: Record<
  TreasurySimpleCashRiskPeriod,
  string
> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "60d": "60 dias",
  "90d": "90 dias",
};

export const TREASURY_SIMPLE_CASH_RISK_SCENARIOS = [
  "CONTRACTUAL",
  "PROBABLE",
] as const;
export type TreasurySimpleCashRiskScenario =
  (typeof TREASURY_SIMPLE_CASH_RISK_SCENARIOS)[number];

/** Linguagem simples — sem inventar probabilidade estatística. */
export const TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS: Record<
  TreasurySimpleCashRiskScenario,
  { short: string; description: string }
> = {
  CONTRACTUAL: {
    short: "Contratual",
    description: "Saldo esperado pelas datas oficiais",
  },
  PROBABLE: {
    short: "Provável",
    description: "Saldo mais provável pelas expectativas informadas",
  },
};

export type TreasurySimpleCashRiskReserveIndicator = {
  projectedBalance: TreasuryMoneyString;
  minimumReserve: TreasuryMoneyString;
  /** projected − reserve (positivo = excedente; negativo = insuficiência). */
  surplusOrShortage: TreasuryMoneyString;
  /** Somente quando reserva > 0; null caso contrário. */
  surplusPercent: string | null;
  kind: "SURPLUS" | "SHORTAGE" | "EXACT" | "NO_RESERVE";
};

export type TreasurySimpleCashRiskSummaryDto = {
  openingBalance: TreasuryMoneyString | null;
  plannedInflows: TreasuryMoneyString;
  plannedOutflows: TreasuryMoneyString;
  lowestBalance: TreasuryMoneyString | null;
  lowestBalanceDate: string | null;
  firstNegativeDate: string | null;
  largestDeficit: TreasuryMoneyString | null;
  largestDeficitDate: string | null;
  firstDayBelowReserve: string | null;
  largestSurplusVsReserve: TreasuryMoneyString | null;
  largestSurplusVsReserveDate: string | null;
  reserve: TreasurySimpleCashRiskReserveIndicator | null;
  topImpacts: Array<{
    id: string;
    label: string;
    amount: TreasuryMoneyString;
    civilDate: string | null;
    accountId: string | null;
  }>;
};

export type TreasurySimpleCashRiskDayDetailDto = {
  civilDate: string;
  previousBalance: TreasuryMoneyString;
  receipts: TreasuryMoneyString;
  payments: TreasuryMoneyString;
  transfers: TreasuryMoneyString;
  closingBalance: TreasuryMoneyString | null;
  mainTitles: Array<{
    id: string;
    label: string;
    amount: TreasuryMoneyString;
    origin: "CONTRACTUAL" | "PROBABLE" | "OTHER";
  }>;
  scenario: TreasurySimpleCashRiskScenario;
  scenarioDescription: string;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

/**
 * Reserva consolidada = soma dos minimumBalance das contas ativas incluídas.
 * Aditiva e auditável (origem: configuração da conta).
 */
export function resolveTreasurySimpleCashRiskReserve(
  accounts: ReadonlyArray<{
    isActive?: boolean;
    includeInConsolidated?: boolean;
    minimumBalance?: string | null;
  }>
): TreasuryMoneyString {
  let total: TreasuryMoneyString = "0.00";
  for (const acc of accounts) {
    if (acc.isActive === false) continue;
    if (acc.includeInConsolidated === false) continue;
    total = addTreasuryMoney(total, money(acc.minimumBalance));
  }
  return total;
}

/**
 * Indicador: saldo projetado − reserva = excedente/insuficiência.
 * Percentual só se reserva > 0.
 */
export function computeTreasurySimpleCashRiskReserveIndicator(input: {
  projectedBalance: string;
  minimumReserve: string;
}): TreasurySimpleCashRiskReserveIndicator {
  const projected = money(input.projectedBalance);
  const reserve = money(input.minimumReserve);
  const surplusOrShortage = subtractTreasuryMoney(projected, reserve);

  if (compareTreasuryMoney(reserve, "0.00") <= 0) {
    return {
      projectedBalance: projected,
      minimumReserve: reserve,
      surplusOrShortage,
      surplusPercent: null,
      kind: "NO_RESERVE",
    };
  }

  const cmp = compareTreasuryMoney(surplusOrShortage, "0.00");
  const kind = cmp > 0 ? "SURPLUS" : cmp < 0 ? "SHORTAGE" : "EXACT";

  // (excedente / reserva) * 100 — só para excedente positivo; insuficiência não vira “superávit %”.
  const surplusPercent =
    cmp > 0 ? computeSurplusPercentOverReserve(surplusOrShortage, reserve) : null;

  return {
    projectedBalance: projected,
    minimumReserve: reserve,
    surplusOrShortage,
    surplusPercent,
    kind,
  };
}

/** (excedente ÷ reserva × 100) com 2 casas HALF_UP; null se reserva ≤ 0. */
export function computeSurplusPercentOverReserve(
  surplus: TreasuryMoneyString,
  reserveMinimum: TreasuryMoneyString
): TreasuryMoneyString | null {
  const reserveCents = treasuryMoneyToCents(money(reserveMinimum));
  if (reserveCents <= 0n) return null;
  const surplusCents = treasuryMoneyToCents(money(surplus));
  if (surplusCents <= 0n) return null;
  const scaled = surplusCents * 10000n;
  const half = reserveCents / 2n;
  const rounded = (scaled + half) / reserveCents;
  return treasuryMoneyFromCents(rounded);
}

export function buildTreasurySimpleCashRiskSummary(input: {
  days: readonly TreasuryAgendaDayDto[];
  minimumReserve: string;
  scenario: TreasurySimpleCashRiskScenario;
}): TreasurySimpleCashRiskSummaryDto {
  const days = [...input.days].sort((a, b) =>
    a.civilDate.localeCompare(b.civilDate)
  );
  const points = days
    .filter((d) => d.closingBalance != null)
    .map((d) => ({
      civilDate: d.civilDate,
      closingBalance: money(d.closingBalance),
    }));

  let plannedInflows: TreasuryMoneyString = "0.00";
  let plannedOutflows: TreasuryMoneyString = "0.00";
  for (const d of days) {
    plannedInflows = addTreasuryMoney(
      plannedInflows,
      money(d.plannedInflows ?? d.inflows)
    );
    plannedOutflows = addTreasuryMoney(
      plannedOutflows,
      money(d.plannedOutflows ?? d.outflows)
    );
  }

  const min = findMinimumClosingBalance(points);
  const firstNegative = findFirstNegativeCivilDate(points);

  let largestDeficit: TreasuryMoneyString | null = null;
  let largestDeficitDate: string | null = null;
  for (const p of points) {
    if (compareTreasuryMoney(p.closingBalance, "0.00") >= 0) continue;
    const abs = subtractTreasuryMoney("0.00", p.closingBalance);
    if (
      largestDeficit == null ||
      compareTreasuryMoney(abs, largestDeficit) > 0
    ) {
      largestDeficit = abs;
      largestDeficitDate = p.civilDate;
    }
  }

  const reserve = money(input.minimumReserve);
  let firstDayBelowReserve: string | null = null;
  let largestSurplusVsReserve: TreasuryMoneyString | null = null;
  let largestSurplusVsReserveDate: string | null = null;

  if (compareTreasuryMoney(reserve, "0.00") > 0) {
    for (const p of points) {
      const vs = subtractTreasuryMoney(p.closingBalance, reserve);
      if (
        firstDayBelowReserve == null &&
        compareTreasuryMoney(p.closingBalance, reserve) < 0
      ) {
        firstDayBelowReserve = p.civilDate;
      }
      if (compareTreasuryMoney(vs, "0.00") > 0) {
        if (
          largestSurplusVsReserve == null ||
          compareTreasuryMoney(vs, largestSurplusVsReserve) > 0
        ) {
          largestSurplusVsReserve = vs;
          largestSurplusVsReserveDate = p.civilDate;
        }
      }
    }
  }

  const lastClosing =
    points.length > 0 ? points[points.length - 1]!.closingBalance : "0.00";
  const reserveIndicator =
    days.length > 0
      ? computeTreasurySimpleCashRiskReserveIndicator({
          projectedBalance: lastClosing,
          minimumReserve: reserve,
        })
      : null;

  const impactMap = new Map<
    string,
    {
      id: string;
      label: string;
      amount: TreasuryMoneyString;
      civilDate: string | null;
      accountId: string | null;
    }
  >();
  for (const d of days) {
    for (const item of d.items ?? []) {
      const key = item.officialTitleId ?? item.id;
      const abs =
        compareTreasuryMoney(money(item.amount), "0.00") < 0
          ? subtractTreasuryMoney("0.00", money(item.amount))
          : money(item.amount);
      const prev = impactMap.get(key);
      if (!prev) {
        impactMap.set(key, {
          id: key,
          label: item.label ?? item.itemKind ?? key,
          amount: abs,
          civilDate: item.civilDate ?? d.civilDate,
          accountId: item.accountId ?? d.accountId,
        });
      } else {
        prev.amount = addTreasuryMoney(prev.amount, abs);
      }
    }
  }
  const topImpacts = [...impactMap.values()]
    .sort((a, b) => compareTreasuryMoney(b.amount, a.amount))
    .slice(0, 8);

  return {
    openingBalance: days[0] ? money(days[0].openingBalance) : null,
    plannedInflows,
    plannedOutflows,
    lowestBalance: min?.balance ?? null,
    lowestBalanceDate: min?.civilDate ?? null,
    firstNegativeDate: firstNegative,
    largestDeficit,
    largestDeficitDate,
    firstDayBelowReserve,
    largestSurplusVsReserve,
    largestSurplusVsReserveDate,
    reserve: reserveIndicator,
    topImpacts,
  };
}

export function buildTreasurySimpleCashRiskDayDetail(input: {
  day: TreasuryAgendaDayDto;
  scenario: TreasurySimpleCashRiskScenario;
}): TreasurySimpleCashRiskDayDetailDto {
  const day = input.day;
  const items = [...(day.items ?? [])].sort((a, b) =>
    compareTreasuryMoney(money(b.amount), money(a.amount))
  );
  const mainTitles = items.slice(0, 10).map((item) => ({
    id: item.officialTitleId ?? item.id,
    label: item.label ?? item.itemKind ?? item.id,
    amount: money(item.amount),
    origin: resolveCompositionOrigin(item, input.scenario),
  }));

  return {
    civilDate: day.civilDate,
    previousBalance: money(day.openingBalance),
    receipts: money(day.plannedInflows ?? day.inflows),
    payments: money(day.plannedOutflows ?? day.outflows),
    transfers: money(day.transfers),
    closingBalance: day.closingBalance == null ? null : money(day.closingBalance),
    mainTitles,
    scenario: input.scenario,
    scenarioDescription:
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[input.scenario].description,
  };
}

function resolveCompositionOrigin(
  item: TreasuryProjectionCompositionItemDto,
  scenario: TreasurySimpleCashRiskScenario
): "CONTRACTUAL" | "PROBABLE" | "OTHER" {
  const ref = `${item.sourceRef ?? ""} ${item.itemKind ?? ""}`.toUpperCase();
  if (ref.includes("PROBABLE") || ref.includes("EXPECT")) return "PROBABLE";
  if (ref.includes("CONTRACT") || ref.includes("DUE")) return "CONTRACTUAL";
  return scenario === "PROBABLE" ? "PROBABLE" : "CONTRACTUAL";
}

export function periodDaysForTreasurySimpleCashRisk(
  period: TreasurySimpleCashRiskPeriod
): number {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  if (period === "60d") return 60;
  return 90;
}
