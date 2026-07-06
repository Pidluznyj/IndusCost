import { createHash } from "node:crypto";
import { roundMoney } from "./commission-money.js";

/** Status do fechamento mensal persistido. */
export const COMMISSION_MONTHLY_CLOSING_STATUSES = [
  "DRAFT",
  "PREVIEWED",
  "CLOSED",
  "CANCELLED",
  "REPROCESSED",
] as const;

export type CommissionMonthlyClosingStatus =
  (typeof COMMISSION_MONTHLY_CLOSING_STATUSES)[number];

/** Fonte do fechamento — motor por recebimento. */
export const COMMISSION_MONTHLY_CLOSING_SOURCES = ["RECEIPT_BASED"] as const;

export type CommissionMonthlyClosingSource =
  (typeof COMMISSION_MONTHLY_CLOSING_SOURCES)[number];

/** Status de linha do ledger por título recebido. */
export const COMMISSION_RECEIPT_LEDGER_LINE_STATUSES = [
  "COMMISSIONABLE",
  "CUSTOMER_EXCLUDED",
  "NO_SALES_LINK",
  "NO_SELLER",
  "SELLER_UNRESOLVED",
  "NO_RULE",
  "ZERO_AMOUNT",
  "ERROR",
] as const;

export type CommissionReceiptLedgerLineStatus =
  (typeof COMMISSION_RECEIPT_LEDGER_LINE_STATUSES)[number];

/** Fechamentos que bloqueiam novo fechamento CLOSED no mesmo mês sem cancelar/reprocessar. */
export const COMMISSION_MONTHLY_CLOSING_LOCKING_STATUSES: CommissionMonthlyClosingStatus[] = [
  "CLOSED",
];

export type CommissionRuleSnapshot = {
  ruleId: string;
  ruleName: string;
  beneficiaryType: string;
  calculationType: string;
  baseType: string;
  releaseRule: string;
  ratePercent: number;
  validFrom: string | null;
  validTo: string | null;
  capturedAt: string;
};

export type CommissionReceiptLedgerLineKeyInput = {
  year: number;
  month: number;
  nomusReceivableId: number | null;
  commissionRecordId: string | null;
  commissionPaymentScheduleId: string | null;
  installmentNumber: number | null;
  nomusOrderItemId: number | null;
  ruleId: string | null;
};

export type CommissionMonthlyClosingHashInput = {
  year: number;
  month: number;
  source: CommissionMonthlyClosingSource;
  lineKeys: string[];
};

/** Normalização monetária do ledger — mesma regra do módulo de comissões. */
export function normalizeCommissionLedgerMoney(
  value: number | null | undefined
): number {
  return roundMoney(value ?? 0);
}

export function isCommissionMonthlyClosingStatus(
  value: string
): value is CommissionMonthlyClosingStatus {
  return (COMMISSION_MONTHLY_CLOSING_STATUSES as readonly string[]).includes(value);
}

export function isCommissionReceiptLedgerLineStatus(
  value: string
): value is CommissionReceiptLedgerLineStatus {
  return (COMMISSION_RECEIPT_LEDGER_LINE_STATUSES as readonly string[]).includes(value);
}

export function isCommissionMonthlyClosingSource(
  value: string
): value is CommissionMonthlyClosingSource {
  return (COMMISSION_MONTHLY_CLOSING_SOURCES as readonly string[]).includes(value);
}

/**
 * Chave determinística por título/parcela/record/schedule/regra.
 * Evita duplicidade lógica no ledger (unique em ledgerLineKey).
 */
export function buildCommissionReceiptLedgerLineKey(
  input: CommissionReceiptLedgerLineKeyInput
): string {
  const payload = [
    input.year,
    input.month,
    input.nomusReceivableId ?? "",
    input.commissionRecordId ?? "",
    input.commissionPaymentScheduleId ?? "",
    input.installmentNumber ?? "",
    input.nomusOrderItemId ?? "",
    input.ruleId ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/** Hash do fechamento mensal (snapshot das linhas ordenadas). */
export function buildCommissionMonthlyClosingHash(
  input: CommissionMonthlyClosingHashInput
): string {
  const sortedKeys = [...input.lineKeys].sort();
  const payload = [
    input.year,
    input.month,
    input.source,
    sortedKeys.join(","),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function serializeCommissionRuleSnapshot(rule: {
  id: string;
  name: string;
  beneficiaryType: string;
  calculationType: string;
  baseType: string;
  releaseRule: string;
  ratePercent: number;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
}): CommissionRuleSnapshot {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    beneficiaryType: rule.beneficiaryType,
    calculationType: rule.calculationType,
    baseType: rule.baseType,
    releaseRule: rule.releaseRule,
    ratePercent: normalizeCommissionLedgerMoney(rule.ratePercent),
    validFrom: rule.validFrom ? new Date(rule.validFrom).toISOString() : null,
    validTo: rule.validTo ? new Date(rule.validTo).toISOString() : null,
    capturedAt: new Date().toISOString(),
  };
}

export function parseCommissionRuleSnapshot(
  value: unknown
): CommissionRuleSnapshot | null {
  if (value == null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ruleId !== "string" || typeof row.ruleName !== "string") {
    return null;
  }
  return {
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    beneficiaryType: String(row.beneficiaryType ?? ""),
    calculationType: String(row.calculationType ?? ""),
    baseType: String(row.baseType ?? ""),
    releaseRule: String(row.releaseRule ?? ""),
    ratePercent: normalizeCommissionLedgerMoney(Number(row.ratePercent)),
    validFrom: row.validFrom != null ? String(row.validFrom) : null,
    validTo: row.validTo != null ? String(row.validTo) : null,
    capturedAt: String(row.capturedAt ?? new Date().toISOString()),
  };
}
