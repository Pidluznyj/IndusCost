/**
 * Money kit da Tesouraria — strings decimais, sem Prisma / sem number em cálculos críticos.
 * Seguro para frontend e backend.
 */

import type { TreasuryMoneyString } from "./contracts/treasuryContracts.js";

const MONEY_RE = /^-?\d+(\.\d{1,2})?$/;

export function isTreasuryMoneyString(value: unknown): value is TreasuryMoneyString {
  return typeof value === "string" && MONEY_RE.test(value.trim());
}

/**
 * Normaliza entrada para string decimal com até 2 casas (sem parse Float).
 * Aceita "10", "10.5", "10.50", "-1.00". Rejeita vírgula e notação científica.
 */
export function normalizeTreasuryMoneyString(value: string): TreasuryMoneyString {
  const trimmed = value.trim();
  if (!MONEY_RE.test(trimmed)) {
    throw new Error(`Valor monetário inválido para Tesouraria: ${value}`);
  }
  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = raw.split(".");
  const frac = (fracPart + "00").slice(0, 2);
  const normalized = `${negative ? "-" : ""}${intPart}.${frac}`;
  return normalized;
}

/** Soma duas strings decimais (centavos inteiros) — sem ponto flutuante. */
export function addTreasuryMoney(
  a: TreasuryMoneyString,
  b: TreasuryMoneyString
): TreasuryMoneyString {
  const cents = toCents(a) + toCents(b);
  return fromCents(cents);
}

export function negateTreasuryMoney(value: TreasuryMoneyString): TreasuryMoneyString {
  const n = normalizeTreasuryMoneyString(value);
  if (n === "0.00") return n;
  return n.startsWith("-") ? n.slice(1) : `-${n}`;
}

function toCents(value: TreasuryMoneyString): number {
  const n = normalizeTreasuryMoneyString(value);
  const negative = n.startsWith("-");
  const raw = negative ? n.slice(1) : n;
  const [intPart, fracPart] = raw.split(".");
  const cents = Number(intPart) * 100 + Number(fracPart);
  return negative ? -cents : cents;
}

function fromCents(cents: number): TreasuryMoneyString {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}
