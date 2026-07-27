/**
 * Comparação pura entre cenários CONTRACTUAL / PROBABLE / CONFIRMED.
 * Sem I/O — monta saldos, diferenças, incerteza, risco e resumo do período.
 */

import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  pickHigherRiskCode,
  treasuryAgendaRiskLabel,
} from "./treasuryAgendaDayRules.js";

export const TREASURY_COMPARISON_SCENARIOS = [
  "CONTRACTUAL",
  "PROBABLE",
  "CONFIRMED",
] as const;

export type TreasuryComparisonScenario = (typeof TREASURY_COMPARISON_SCENARIOS)[number];

export type TreasuryProjectionComparisonDaySeed = {
  civilDate: string;
  closingBalance: string;
  uncertainReceivables: string;
  riskAmount: string;
  riskCode: string;
};

export type TreasuryProjectionComparisonBalances = Record<
  TreasuryComparisonScenario,
  TreasuryMoneyString | null
>;

export type TreasuryProjectionComparisonDay = {
  civilDate: string;
  balances: TreasuryProjectionComparisonBalances;
  differences: {
    probableMinusContractual: TreasuryMoneyString | null;
    confirmedMinusProbable: TreasuryMoneyString | null;
    confirmedMinusContractual: TreasuryMoneyString | null;
  };
  uncertainReceivables: TreasuryProjectionComparisonBalances & {
    /** Maior incerteza do dia entre cenários disponíveis. */
    max: TreasuryMoneyString | null;
    /** Preferência: CONTRACTUAL → PROBABLE → CONFIRMED. */
    primary: TreasuryMoneyString | null;
  };
  highestRisk: {
    riskCode: string;
    riskAmount: TreasuryMoneyString;
    riskLabel: string;
    scenario: TreasuryComparisonScenario | null;
  };
};

export type TreasuryProjectionComparisonScenarioSummary = {
  scenario: TreasuryComparisonScenario;
  available: boolean;
  firstNegativeDate: string | null;
  minimumBalance: TreasuryMoneyString | null;
  minimumBalanceDate: string | null;
  dayCount: number;
};

export type TreasuryProjectionComparisonResult = {
  days: TreasuryProjectionComparisonDay[];
  byScenario: Record<
    TreasuryComparisonScenario,
    TreasuryProjectionComparisonScenarioSummary
  >;
  firstNegativeDateOverall: string | null;
  minimumBalanceOverall: TreasuryMoneyString | null;
  minimumBalanceOverallDate: string | null;
  minimumBalanceOverallScenario: TreasuryComparisonScenario | null;
};

const ZERO = "0.00" as TreasuryMoneyString;

function moneyOrNull(value: string | null | undefined): TreasuryMoneyString | null {
  if (value == null || value === "") return null;
  return normalizeTreasuryMoneyString(value);
}

function diffMoney(
  a: TreasuryMoneyString | null,
  b: TreasuryMoneyString | null
): TreasuryMoneyString | null {
  if (a == null || b == null) return null;
  return subtractTreasuryMoney(a, b);
}

function maxMoney(
  values: Array<TreasuryMoneyString | null>
): TreasuryMoneyString | null {
  let best: TreasuryMoneyString | null = null;
  for (const v of values) {
    if (v == null) continue;
    if (best == null || compareTreasuryMoney(v, best) > 0) best = v;
  }
  return best;
}

export function findFirstNegativeCivilDate(
  points: Array<{ civilDate: string; closingBalance: string }>
): string | null {
  const sorted = [...points].sort((a, b) =>
    a.civilDate.localeCompare(b.civilDate)
  );
  for (const p of sorted) {
    const bal = normalizeTreasuryMoneyString(p.closingBalance);
    if (compareTreasuryMoney(bal, ZERO) < 0) return p.civilDate;
  }
  return null;
}

export function findMinimumClosingBalance(
  points: Array<{ civilDate: string; closingBalance: string }>
): { balance: TreasuryMoneyString; civilDate: string } | null {
  if (points.length === 0) return null;
  let best = {
    balance: normalizeTreasuryMoneyString(points[0]!.closingBalance),
    civilDate: points[0]!.civilDate,
  };
  for (const p of points.slice(1)) {
    const bal = normalizeTreasuryMoneyString(p.closingBalance);
    const cmp = compareTreasuryMoney(bal, best.balance);
    if (
      cmp < 0 ||
      (cmp === 0 && p.civilDate.localeCompare(best.civilDate) < 0)
    ) {
      best = { balance: bal, civilDate: p.civilDate };
    }
  }
  return best;
}

function riskRank(code: string): number {
  const map: Record<string, number> = {
    NONE: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  return map[(code || "NONE").toUpperCase()] ?? 0;
}

/**
 * Consistência: diferença A−B deve bater com subtractTreasuryMoney dos saldos.
 */
export function assertScenarioDifferenceConsistency(day: TreasuryProjectionComparisonDay): void {
  const { balances, differences } = day;
  const expectedProbContr = diffMoney(
    balances.PROBABLE,
    balances.CONTRACTUAL
  );
  const expectedConfProb = diffMoney(balances.CONFIRMED, balances.PROBABLE);
  const expectedConfContr = diffMoney(
    balances.CONFIRMED,
    balances.CONTRACTUAL
  );
  if (expectedProbContr !== differences.probableMinusContractual) {
    throw new Error(
      `Diferença PROBABLE−CONTRACTUAL inconsistente em ${day.civilDate}`
    );
  }
  if (expectedConfProb !== differences.confirmedMinusProbable) {
    throw new Error(
      `Diferença CONFIRMED−PROBABLE inconsistente em ${day.civilDate}`
    );
  }
  if (expectedConfContr !== differences.confirmedMinusContractual) {
    throw new Error(
      `Diferença CONFIRMED−CONTRACTUAL inconsistente em ${day.civilDate}`
    );
  }
}

export function buildTreasuryProjectionComparison(input: {
  byScenario: Partial<
    Record<TreasuryComparisonScenario, TreasuryProjectionComparisonDaySeed[]>
  >;
}): TreasuryProjectionComparisonResult {
  const maps = {} as Record<
    TreasuryComparisonScenario,
    Map<string, TreasuryProjectionComparisonDaySeed>
  >;
  for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
    const map = new Map<string, TreasuryProjectionComparisonDaySeed>();
    for (const seed of input.byScenario[scenario] ?? []) {
      map.set(seed.civilDate, {
        ...seed,
        closingBalance: normalizeTreasuryMoneyString(seed.closingBalance),
        uncertainReceivables: normalizeTreasuryMoneyString(
          seed.uncertainReceivables || ZERO
        ),
        riskAmount: normalizeTreasuryMoneyString(seed.riskAmount || ZERO),
        riskCode: (seed.riskCode || "NONE").toUpperCase(),
      });
    }
    maps[scenario] = map;
  }

  const dates = new Set<string>();
  for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
    for (const d of maps[scenario].keys()) dates.add(d);
  }

  const days: TreasuryProjectionComparisonDay[] = [...dates]
    .sort()
    .map((civilDate) => {
      const bal: TreasuryProjectionComparisonBalances = {
        CONTRACTUAL: moneyOrNull(
          maps.CONTRACTUAL.get(civilDate)?.closingBalance
        ),
        PROBABLE: moneyOrNull(maps.PROBABLE.get(civilDate)?.closingBalance),
        CONFIRMED: moneyOrNull(maps.CONFIRMED.get(civilDate)?.closingBalance),
      };
      const uncertain: TreasuryProjectionComparisonBalances = {
        CONTRACTUAL: moneyOrNull(
          maps.CONTRACTUAL.get(civilDate)?.uncertainReceivables
        ),
        PROBABLE: moneyOrNull(
          maps.PROBABLE.get(civilDate)?.uncertainReceivables
        ),
        CONFIRMED: moneyOrNull(
          maps.CONFIRMED.get(civilDate)?.uncertainReceivables
        ),
      };
      const primaryUncertain =
        uncertain.CONTRACTUAL ??
        uncertain.PROBABLE ??
        uncertain.CONFIRMED ??
        null;

      let highestCode = "NONE";
      let highestAmount = ZERO;
      let highestScenario: TreasuryComparisonScenario | null = null;
      for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
        const seed = maps[scenario].get(civilDate);
        if (!seed) continue;
        if (highestScenario == null) {
          highestCode = seed.riskCode;
          highestAmount = seed.riskAmount;
          highestScenario = scenario;
          continue;
        }
        const codeCmp = riskRank(seed.riskCode) - riskRank(highestCode);
        if (
          codeCmp > 0 ||
          (codeCmp === 0 &&
            compareTreasuryMoney(seed.riskAmount, highestAmount) > 0)
        ) {
          highestCode = pickHigherRiskCode(highestCode, seed.riskCode);
          highestAmount = seed.riskAmount;
          highestScenario = scenario;
        }
      }

      const day: TreasuryProjectionComparisonDay = {
        civilDate,
        balances: bal,
        differences: {
          probableMinusContractual: diffMoney(bal.PROBABLE, bal.CONTRACTUAL),
          confirmedMinusProbable: diffMoney(bal.CONFIRMED, bal.PROBABLE),
          confirmedMinusContractual: diffMoney(
            bal.CONFIRMED,
            bal.CONTRACTUAL
          ),
        },
        uncertainReceivables: {
          ...uncertain,
          max: maxMoney([
            uncertain.CONTRACTUAL,
            uncertain.PROBABLE,
            uncertain.CONFIRMED,
          ]),
          primary: primaryUncertain,
        },
        highestRisk: {
          riskCode: highestCode,
          riskAmount: highestAmount,
          riskLabel: treasuryAgendaRiskLabel(highestCode, highestAmount),
          scenario: highestScenario,
        },
      };
      return day;
    });

  const byScenario = {} as Record<
    TreasuryComparisonScenario,
    TreasuryProjectionComparisonScenarioSummary
  >;
  for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
    const points = [...maps[scenario].values()].map((s) => ({
      civilDate: s.civilDate,
      closingBalance: s.closingBalance,
    }));
    const min = findMinimumClosingBalance(points);
    byScenario[scenario] = {
      scenario,
      available: points.length > 0,
      firstNegativeDate: findFirstNegativeCivilDate(points),
      minimumBalance: min?.balance ?? null,
      minimumBalanceDate: min?.civilDate ?? null,
      dayCount: points.length,
    };
  }

  let firstNegativeDateOverall: string | null = null;
  for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
    const d = byScenario[scenario].firstNegativeDate;
    if (!d) continue;
    if (!firstNegativeDateOverall || d < firstNegativeDateOverall) {
      firstNegativeDateOverall = d;
    }
  }

  let minimumBalanceOverall: TreasuryMoneyString | null = null;
  let minimumBalanceOverallDate: string | null = null;
  let minimumBalanceOverallScenario: TreasuryComparisonScenario | null = null;
  for (const scenario of TREASURY_COMPARISON_SCENARIOS) {
    const s = byScenario[scenario];
    if (s.minimumBalance == null || s.minimumBalanceDate == null) continue;
    if (
      minimumBalanceOverall == null ||
      compareTreasuryMoney(s.minimumBalance, minimumBalanceOverall) < 0 ||
      (compareTreasuryMoney(s.minimumBalance, minimumBalanceOverall) === 0 &&
        s.minimumBalanceDate < (minimumBalanceOverallDate ?? ""))
    ) {
      minimumBalanceOverall = s.minimumBalance;
      minimumBalanceOverallDate = s.minimumBalanceDate;
      minimumBalanceOverallScenario = scenario;
    }
  }

  return {
    days,
    byScenario,
    firstNegativeDateOverall,
    minimumBalanceOverall,
    minimumBalanceOverallDate,
    minimumBalanceOverallScenario,
  };
}

/** Type guard helper for UI / API layers. */
export function isTreasuryComparisonScenario(
  value: string
): value is TreasuryComparisonScenario {
  return (TREASURY_COMPARISON_SCENARIOS as readonly string[]).includes(value);
}

export type { TreasuryProjectionLayer };
