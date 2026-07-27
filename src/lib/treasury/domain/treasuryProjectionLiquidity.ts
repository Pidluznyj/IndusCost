/**
 * Liquidez de aplicações financeiras na projeção de caixa (Tesouraria).
 * Funções puras — sem I/O.
 */

import {
  addCivilDays,
  compareCivilDates,
} from "@/src/lib/financeCivilDate.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export const TREASURY_PROJECTION_LIQUIDITY_LAGS = [
  "IMMEDIATE",
  "D_PLUS_1",
  "D_PLUS_2",
  "D_PLUS_3",
] as const;

export type TreasuryProjectionLiquidityLag =
  (typeof TREASURY_PROJECTION_LIQUIDITY_LAGS)[number];

export const TREASURY_PROJECTION_LIQUIDITY_OFFSET_DAYS: Record<
  TreasuryProjectionLiquidityLag,
  number
> = {
  IMMEDIATE: 0,
  D_PLUS_1: 1,
  D_PLUS_2: 2,
  D_PLUS_3: 3,
};

export type TreasuryProjectionApplicationSeed = {
  id: string;
  accountId: string;
  amount: string;
  investedOn: string;
  liquidity: TreasuryProjectionLiquidityLag;
  isCancelled?: boolean;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(
    value == null || value === "" ? "0" : value
  );
}

export function resolveTreasuryLiquidityAvailableDate(
  investedOn: string,
  liquidity: TreasuryProjectionLiquidityLag
): string {
  const offset = TREASURY_PROJECTION_LIQUIDITY_OFFSET_DAYS[liquidity];
  const available = addCivilDays(investedOn, offset);
  if (!available) {
    throw new Error(
      `Data de liquidez inválida: investedOn=${investedOn} liquidity=${liquidity}`
    );
  }
  return available;
}

type ApplicationLiquidityRef = {
  investedOn: string;
  liquidity: TreasuryProjectionLiquidityLag;
};

export function isTreasuryApplicationAvailableOn(
  application: ApplicationLiquidityRef,
  civilDate: string
): boolean {
  const availableOn = resolveTreasuryLiquidityAvailableDate(
    application.investedOn,
    application.liquidity
  );
  return compareCivilDates(availableOn, civilDate) <= 0;
}

export function isTreasuryApplicationMaturingOn(
  application: ApplicationLiquidityRef,
  civilDate: string
): boolean {
  const availableOn = resolveTreasuryLiquidityAvailableDate(
    application.investedOn,
    application.liquidity
  );
  return compareCivilDates(availableOn, civilDate) === 0;
}

export function isTreasuryApplicationStillLockedOn(
  application: ApplicationLiquidityRef,
  civilDate: string
): boolean {
  const availableOn = resolveTreasuryLiquidityAvailableDate(
    application.investedOn,
    application.liquidity
  );
  return compareCivilDates(availableOn, civilDate) > 0;
}

export function resolveTreasuryApplicationLiquidityForDay(input: {
  applications: readonly TreasuryProjectionApplicationSeed[];
  accountId: string;
  civilDate: string;
}): {
  maturingToday: TreasuryMoneyString;
  stillLocked: TreasuryMoneyString;
  alreadyAvailable: TreasuryMoneyString;
} {
  let maturingToday = "0.00";
  let stillLocked = "0.00";
  let alreadyAvailable = "0.00";

  for (const app of input.applications) {
    if (app.accountId !== input.accountId) continue;
    const amount = money(app.amount);
    if (isTreasuryApplicationMaturingOn(app, input.civilDate)) {
      maturingToday = addTreasuryMoney(maturingToday, amount);
    } else if (isTreasuryApplicationStillLockedOn(app, input.civilDate)) {
      stillLocked = addTreasuryMoney(stillLocked, amount);
    } else if (isTreasuryApplicationAvailableOn(app, input.civilDate)) {
      alreadyAvailable = addTreasuryMoney(alreadyAvailable, amount);
    }
  }

  return { maturingToday, stillLocked, alreadyAvailable };
}

export function resolveTreasuryCreditAvailable(input: {
  creditLimit: string;
  usedLimit: string;
}): TreasuryMoneyString {
  return subtractTreasuryMoney(money(input.creditLimit), money(input.usedLimit));
}