/**
 * Money kit da Tesouraria — strings decimais com BigInt (centavos).
 * Sem Prisma / sem number em cálculos críticos. Seguro para frontend e backend.
 */

export type TreasuryMoneyString = string;

export const TREASURY_MONEY_ROUNDING = "HALF_UP" as const;
export const TREASURY_MONEY_SCALE = 2 as const;

/** Até 2 casas decimais (strict). */
const STRICT_MONEY_RE = /^-?\d+(\.\d{1,2})?$/;
/** Aceita mais casas para arredondamento HALF_UP. */
const ROUNDABLE_MONEY_RE = /^-?\d+(\.\d+)?$/;

export function isTreasuryMoneyString(value: unknown): value is TreasuryMoneyString {
  return typeof value === "string" && STRICT_MONEY_RE.test(value.trim());
}

/**
 * Normaliza entrada para string decimal com até 2 casas (sem parse Float).
 * Aceita "10", "10.5", "10.50", "-1.00". Rejeita vírgula, notação científica e >2 casas.
 */
export function normalizeTreasuryMoneyString(value: string): TreasuryMoneyString {
  const trimmed = value.trim();
  if (!STRICT_MONEY_RE.test(trimmed)) {
    throw new Error(`Valor monetário inválido para Tesouraria: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = raw.split(".");
  const frac = (fracPart + "00").slice(0, TREASURY_MONEY_SCALE);
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}

/**
 * Arredonda para TREASURY_MONEY_SCALE casas com HALF_UP (metade afasta de zero).
 * Aceita mais de 2 casas decimais.
 */
export function roundTreasuryMoneyHalfUp(value: string): TreasuryMoneyString {
  const trimmed = value.trim();
  if (!ROUNDABLE_MONEY_RE.test(trimmed)) {
    throw new Error(`Valor monetário inválido para arredondamento: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = raw.split(".");

  if (fracPart.length <= TREASURY_MONEY_SCALE) {
    const frac = (fracPart + "00").slice(0, TREASURY_MONEY_SCALE);
    const normalized = `${negative ? "-" : ""}${intPart}.${frac}`;
    return normalized === "-0.00" ? "0.00" : normalized;
  }

  const keep = fracPart.slice(0, TREASURY_MONEY_SCALE);
  const nextDigit = Number(fracPart.charAt(TREASURY_MONEY_SCALE));
  let cents = BigInt(intPart) * 100n + BigInt(keep);
  if (nextDigit >= 5) {
    cents += 1n;
  }
  return treasuryMoneyFromCents(negative ? -cents : cents);
}

export function treasuryMoneyToCents(value: TreasuryMoneyString): bigint {
  const n = normalizeTreasuryMoneyString(value);
  const negative = n.startsWith("-");
  const raw = negative ? n.slice(1) : n;
  const [intPart, fracPart] = raw.split(".");
  const cents = BigInt(intPart) * 100n + BigInt(fracPart);
  return negative ? -cents : cents;
}

export function treasuryMoneyFromCents(cents: bigint): TreasuryMoneyString {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / 100n;
  const frac = abs % 100n;
  const out = `${negative ? "-" : ""}${intPart.toString()}.${frac.toString().padStart(TREASURY_MONEY_SCALE, "0")}`;
  return out === "-0.00" ? "0.00" : out;
}

/** Soma duas strings decimais (centavos BigInt) — sem ponto flutuante. */
export function addTreasuryMoney(
  a: TreasuryMoneyString,
  b: TreasuryMoneyString
): TreasuryMoneyString {
  return treasuryMoneyFromCents(treasuryMoneyToCents(a) + treasuryMoneyToCents(b));
}

export function subtractTreasuryMoney(
  a: TreasuryMoneyString,
  b: TreasuryMoneyString
): TreasuryMoneyString {
  return treasuryMoneyFromCents(treasuryMoneyToCents(a) - treasuryMoneyToCents(b));
}

export function sumTreasuryMoney(
  values: readonly TreasuryMoneyString[]
): TreasuryMoneyString {
  let total = 0n;
  for (const v of values) {
    total += treasuryMoneyToCents(v);
  }
  return treasuryMoneyFromCents(total);
}

export function negateTreasuryMoney(value: TreasuryMoneyString): TreasuryMoneyString {
  const n = normalizeTreasuryMoneyString(value);
  if (n === "0.00") return n;
  return n.startsWith("-") ? n.slice(1) : `-${n}`;
}

/** Compara duas strings decimais: <0 se a<b, 0 se iguais, >0 se a>b. */
export function compareTreasuryMoney(
  a: TreasuryMoneyString,
  b: TreasuryMoneyString
): number {
  const diff = treasuryMoneyToCents(a) - treasuryMoneyToCents(b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}