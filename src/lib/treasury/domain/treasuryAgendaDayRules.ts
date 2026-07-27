/**
 * Montagem pura das linhas da agenda financeira (buckets + risco textual).
 */

import type { TreasuryAgendaDayDto } from "../contracts/treasuryDto.js";
import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

const ZERO = "0.00" as TreasuryMoneyString;

const RISK_RANK: Record<string, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export type TreasuryAgendaScenarioDaySeed = {
  civilDate: string;
  accountId: string | null;
  openingBalance: string;
  inflows: string;
  outflows: string;
  transfers: string;
  realized: string;
  closingBalance: string;
  riskAmount: string;
  riskCode: string;
  itemCount: number;
};

export function treasuryAgendaRiskLabel(
  riskCode: string,
  riskAmount: string
): string {
  const code = (riskCode || "NONE").toUpperCase();
  const amount = normalizeTreasuryMoneyString(riskAmount || "0");
  if (code === "NONE" || compareTreasuryMoney(amount, "0") === 0) {
    return "Sem risco material";
  }
  const names: Record<string, string> = {
    LOW: "Baixo",
    MEDIUM: "Médio",
    HIGH: "Alto",
    CRITICAL: "Crítico",
  };
  const name = names[code] ?? code;
  return `Risco ${name} (${code}): ${amount}`;
}

export function pickHigherRiskCode(a: string, b: string): string {
  const ra = RISK_RANK[(a || "NONE").toUpperCase()] ?? 0;
  const rb = RISK_RANK[(b || "NONE").toUpperCase()] ?? 0;
  return ra >= rb ? (a || "NONE").toUpperCase() : (b || "NONE").toUpperCase();
}

/**
 * Combina seeds por cenário em uma linha de agenda.
 * - CONTRACTUAL → previsto
 * - PROBABLE → programado (saídas) / previsto reforçado (entradas)
 * - CONFIRMED → confirmado
 * Realizado / abertura / fechamento / transfer / risco vêm do cenário primário.
 */
export function buildTreasuryAgendaDay(input: {
  civilDate: string;
  accountId?: string | null;
  accountCode?: string | null;
  accountName?: string | null;
  primaryScenario: TreasuryProjectionLayer;
  byScenario: Partial<
    Record<TreasuryProjectionLayer, TreasuryAgendaScenarioDaySeed>
  >;
  items?: TreasuryAgendaDayDto["items"];
}): TreasuryAgendaDayDto {
  const contractual = input.byScenario.CONTRACTUAL;
  const probable = input.byScenario.PROBABLE;
  const confirmed = input.byScenario.CONFIRMED;
  const primary =
    input.byScenario[input.primaryScenario] ??
    probable ??
    contractual ??
    confirmed;

  const opening = normalizeTreasuryMoneyString(
    primary?.openingBalance ?? ZERO
  );
  const closing = primary?.closingBalance
    ? normalizeTreasuryMoneyString(primary.closingBalance)
    : null;
  const transfers = normalizeTreasuryMoneyString(primary?.transfers ?? ZERO);
  const riskAmount = normalizeTreasuryMoneyString(primary?.riskAmount ?? ZERO);
  const riskCode = (primary?.riskCode ?? "NONE").toUpperCase();

  const plannedInflows = normalizeTreasuryMoneyString(
    contractual?.inflows ?? probable?.inflows ?? ZERO
  );
  const confirmedInflows = normalizeTreasuryMoneyString(
    confirmed?.inflows ?? ZERO
  );
  const plannedOutflows = normalizeTreasuryMoneyString(
    contractual?.outflows ?? ZERO
  );
  const programmedOutflows = normalizeTreasuryMoneyString(
    probable?.outflows ?? ZERO
  );

  const realizedRaw = normalizeTreasuryMoneyString(primary?.realized ?? ZERO);
  const realizedInflows =
    compareTreasuryMoney(realizedRaw, "0") > 0 ? realizedRaw : ZERO;
  const realizedOutflows =
    compareTreasuryMoney(realizedRaw, "0") < 0
      ? negateTreasuryMoney(realizedRaw)
      : ZERO;

  // Preferir composição implícita: se realizado líquido positivo, entrada; se
  // o motor já separou realized no day line, mantemos acima. Saídas realizadas
  // também podem vir das outflows do cenário quando o day line marca realized.
  const primaryInflows = normalizeTreasuryMoneyString(primary?.inflows ?? ZERO);
  const primaryOutflows = normalizeTreasuryMoneyString(
    primary?.outflows ?? ZERO
  );
  const net = subtractTreasuryMoney(primaryInflows, primaryOutflows);

  return {
    civilDate: input.civilDate as TreasuryAgendaDayDto["civilDate"],
    accountId: input.accountId ?? null,
    accountCode: input.accountCode ?? null,
    accountName: input.accountName ?? null,
    openingBalance: opening,
    plannedInflows,
    confirmedInflows,
    realizedInflows,
    plannedOutflows,
    programmedOutflows,
    realizedOutflows,
    transfers,
    closingBalance: closing,
    riskAmount,
    riskCode,
    riskLabel: treasuryAgendaRiskLabel(riskCode, riskAmount),
    inflows: primaryInflows,
    outflows: primaryOutflows,
    net,
    realized: realizedRaw,
    itemCount: primary?.itemCount ?? 0,
    items: input.items ?? null,
  };
}

export function mergeAgendaScenarioSeeds(
  seeds: TreasuryAgendaScenarioDaySeed[]
): TreasuryAgendaScenarioDaySeed | null {
  if (seeds.length === 0) return null;
  let acc: TreasuryAgendaScenarioDaySeed = {
    ...seeds[0]!,
    openingBalance: normalizeTreasuryMoneyString(seeds[0]!.openingBalance),
    inflows: normalizeTreasuryMoneyString(seeds[0]!.inflows),
    outflows: normalizeTreasuryMoneyString(seeds[0]!.outflows),
    transfers: normalizeTreasuryMoneyString(seeds[0]!.transfers),
    realized: normalizeTreasuryMoneyString(seeds[0]!.realized),
    closingBalance: normalizeTreasuryMoneyString(seeds[0]!.closingBalance),
    riskAmount: normalizeTreasuryMoneyString(seeds[0]!.riskAmount),
    riskCode: (seeds[0]!.riskCode || "NONE").toUpperCase(),
  };
  for (const s of seeds.slice(1)) {
    acc = {
      civilDate: acc.civilDate,
      accountId: acc.accountId,
      openingBalance: addTreasuryMoney(acc.openingBalance, s.openingBalance),
      inflows: addTreasuryMoney(acc.inflows, s.inflows),
      outflows: addTreasuryMoney(acc.outflows, s.outflows),
      transfers: addTreasuryMoney(acc.transfers, s.transfers),
      realized: addTreasuryMoney(acc.realized, s.realized),
      closingBalance: addTreasuryMoney(acc.closingBalance, s.closingBalance),
      riskAmount: addTreasuryMoney(acc.riskAmount, s.riskAmount),
      riskCode: pickHigherRiskCode(acc.riskCode, s.riskCode),
      itemCount: acc.itemCount + s.itemCount,
    };
  }
  return acc;
}
