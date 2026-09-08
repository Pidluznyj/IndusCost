/**
 * Regras saneadas de Contas a Pagar — fonte única para AP e Fluxo de Caixa.
 *
 * Dashboards gerenciais alocam títulos AP (abertos e quitados) pela data de vencimento.
 * paymentDate/settlementDate permanecem apenas para auditoria operacional.
 */

import {
  FINANCE_SETTLEMENT_RECONCILIATION_LEGACY,
  resolveFinanceEffectiveSettlementDate,
  type FinanceSettlementReconciliationPolicy,
} from "@/src/lib/finance/financeSettlementReconciliation.js";

export type FinanceApSettlementKind = "NORMAL" | "WITHOUT_CASH" | "FORCED";

export type FinanceApEffectiveStatus = "OPEN" | "SETTLED" | "CANCELLED";

export type FinanceApRulesInput = {
  externalId?: number;
  dueDate?: Date | null;
  paymentDate?: Date | null;
  settlementDate?: Date | null;
  amountPayable?: number;
  amountPaid?: number;
  balancePayable?: number;
  paymentMethodName?: string | null;
  description?: string | null;
  comments?: string | null;
  classification?: string | null;
  nomusStatus?: boolean | null;
  suspendPayment?: boolean | null;
};

export type NormalizedAccountsPayableTitle = {
  id: number | null;
  dueDate: Date | null;
  originalPaymentDate: Date | null;
  originalSettlementDate: Date | null;
  /** Data de alocação gerencial — sempre vencimento para títulos não cancelados. */
  effectiveDashboardDate: Date | null;
  /** Compatível com dashboards — quitados usam vencimento, não data de baixa. */
  effectivePaymentDate: Date | null;
  effectiveStatus: FinanceApEffectiveStatus;
  settlementKind: FinanceApSettlementKind;
  amountPayable: number;
  amountPaid: number;
  /**
   * AP_SETTLED — realizado gerencial (estado operacional do título): quitado
   * com `amountPaid`, ou `amountPayable` quando baixado sem valor pago
   * informado (regra documentada de Contas a Pagar).
   */
  realizedAmount: number;
  /**
   * AP_CASH_REALIZED — saída de caixa afirmável pela evidência do título:
   * somente `amountPaid` informado (> 0), nunca `amountPayable` inferido.
   * Cancelado → 0. Vale para baixa normal, WITHOUT_CASH e FORCED.
   */
  cashRealizedAmount: number;
  openAmount: number;
  isOpen: boolean;
  isSettled: boolean;
  isCancelled: boolean;
  isSpecialWriteOff: boolean;
};

const WITHOUT_CASH_MARKERS = [
  "BAIXA SEM NUMERARIO",
  "BAIXADA SEM NUMERARIO",
] as const;

const FORCED_MARKERS = [
  "BAIXA FORCADA",
  "BAIXADA NA FORCA",
  "BAIXA MANUAL/FORCADA",
  "BAIXADA FORCADA",
] as const;

const CANCELLED_MARKERS = [
  "CANCELLED",
  "CANCELED",
  "CANCELADO",
  "CANCELADA",
  "ERROR",
  "ERRO",
] as const;

function safeMoney(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeFinanceApRulesText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildApRulesSearchBlob(row: FinanceApRulesInput): string {
  return [
    row.paymentMethodName,
    row.description,
    row.comments,
    row.classification,
  ]
    .map(normalizeFinanceApRulesText)
    .filter(Boolean)
    .join(" ");
}

export function detectApSettlementKind(row: FinanceApRulesInput): FinanceApSettlementKind {
  const blob = buildApRulesSearchBlob(row);
  if (!blob) return "NORMAL";
  for (const marker of WITHOUT_CASH_MARKERS) {
    if (blob.includes(marker)) return "WITHOUT_CASH";
  }
  for (const marker of FORCED_MARKERS) {
    if (blob.includes(marker)) return "FORCED";
  }
  return "NORMAL";
}

export function isFinanceApCancelledTitle(row: FinanceApRulesInput): boolean {
  const blob = buildApRulesSearchBlob(row);
  if (!blob) return false;
  return CANCELLED_MARKERS.some((marker) => blob.includes(marker));
}

export function isFinanceApSpecialWriteOff(row: FinanceApRulesInput): boolean {
  const kind = detectApSettlementKind(row);
  return kind === "WITHOUT_CASH" || kind === "FORCED";
}

export type NormalizeAccountsPayableTitleOptions = {
  /**
   * Política de conciliação — governa `effectivePaymentDate` quando o
   * título estiver liquidado. Sem opções → comportamento LEGADO (dueDate
   * sempre), preservando 100% do comportamento histórico até que o
   * chamador explicitamente ative a regra dos N dias.
   */
  reconciliation?: FinanceSettlementReconciliationPolicy;
};

export function normalizeAccountsPayableTitle(
  row: FinanceApRulesInput,
  options: NormalizeAccountsPayableTitleOptions = {}
): NormalizedAccountsPayableTitle {
  const amountPayable = roundMoney(safeMoney(row.amountPayable));
  const amountPaid = roundMoney(safeMoney(row.amountPaid));
  const balancePayable = roundMoney(safeMoney(row.balancePayable));
  const originalPaymentDate = row.paymentDate ?? null;
  const originalSettlementDate = row.settlementDate ?? null;
  const dueDate = row.dueDate ?? null;

  const isCancelled = isFinanceApCancelledTitle(row);
  const settlementKind = detectApSettlementKind(row);
  const isSpecialWriteOff = settlementKind !== "NORMAL";

  const isSettled = !isCancelled && (balancePayable <= 0 || isSpecialWriteOff);

  const isOpen =
    !isCancelled &&
    !isSettled &&
    balancePayable > 0 &&
    row.suspendPayment !== true;

  let realizedAmount = 0;
  if (!isCancelled) {
    if (isSettled) {
      realizedAmount = amountPaid > 0 ? amountPaid : amountPayable;
    } else if (amountPaid > 0) {
      realizedAmount = amountPaid;
    }
  }

  const openAmount = isOpen ? balancePayable : 0;
  const cashRealizedAmount = !isCancelled && amountPaid > 0 ? amountPaid : 0;

  const effectiveDashboardDate = isCancelled ? null : dueDate;

  let effectivePaymentDate: Date | null = null;
  if (!isCancelled && (isSettled || amountPaid > 0)) {
    // Sem opções → legado (dueDate sempre). Com política → aplica a regra
    // dos N dias sobre paymentDate/settlementDate (o que existir).
    const settledOn = originalPaymentDate ?? originalSettlementDate ?? null;
    effectivePaymentDate = resolveFinanceEffectiveSettlementDate(
      { dueDate, settledOn, isSettled: isSettled || amountPaid > 0 },
      options.reconciliation ?? FINANCE_SETTLEMENT_RECONCILIATION_LEGACY
    );
  }

  const effectiveStatus: FinanceApEffectiveStatus = isCancelled
    ? "CANCELLED"
    : isSettled
      ? "SETTLED"
      : "OPEN";

  return {
    id: row.externalId ?? null,
    dueDate,
    originalPaymentDate,
    originalSettlementDate,
    effectiveDashboardDate,
    effectivePaymentDate,
    effectiveStatus,
    settlementKind,
    amountPayable,
    amountPaid,
    realizedAmount,
    cashRealizedAmount,
    openAmount,
    isOpen,
    isSettled,
    isCancelled,
    isSpecialWriteOff,
  };
}

/** Compatível com dashboards — usa saldo saneado, não apenas balancePayable bruto. */
export function isFinanceApOpenByRules(row: FinanceApRulesInput): boolean {
  return normalizeAccountsPayableTitle(row).isOpen;
}

export function isFinanceApSettledByRules(row: FinanceApRulesInput): boolean {
  return normalizeAccountsPayableTitle(row).isSettled;
}

export function resolveFinanceApEffectiveDashboardDate(row: FinanceApRulesInput): Date | null {
  return normalizeAccountsPayableTitle(row).effectiveDashboardDate;
}

export function resolveFinanceApEffectivePaymentDate(
  row: FinanceApRulesInput,
  options: NormalizeAccountsPayableTitleOptions = {}
): Date | null {
  return normalizeAccountsPayableTitle(row, options).effectivePaymentDate;
}

export function resolveFinanceApRealizedAmount(row: FinanceApRulesInput): number {
  return normalizeAccountsPayableTitle(row).realizedAmount;
}

export function resolveFinanceApOpenAmount(row: FinanceApRulesInput): number {
  return normalizeAccountsPayableTitle(row).openAmount;
}

/**
 * AP_CASH_REALIZED — saída de caixa afirmável pela evidência do título, para
 * tudo que no Fluxo de Caixa se apresenta como pago/realizado/saída.
 * Diferente de `resolveFinanceApRealizedAmount` (AP_SETTLED, estado
 * operacional). Regra de segurança: cashRealized nunca excede o `amountPaid`
 * informado pelo Nomus —
 * - cancelado → 0;
 * - baixa normal com `amountPaid` → `amountPaid` (parcial inclusive);
 * - quitado com `amountPaid = 0` (baixa sem valor pago) → 0: o título fica
 *   encerrado (fora do saldo em aberto), mas não vira saída de caixa;
 * - `WITHOUT_CASH` ("baixa sem numerário") → só `amountPaid` informado;
 * - `FORCED` ("baixa forçada") → só `amountPaid` informado.
 *   FORCED_CASH_SEMANTICS=UNRESOLVED: o espelho não distingue baixa forçada
 *   com ou sem dinheiro; sem inferir `amountPayable` como caixa.
 * Nunca muda o mês do título: a atribuição mensal é sempre pela dueDate.
 */
export function resolveFinanceApCashRealizedAmount(row: FinanceApRulesInput): number {
  return normalizeAccountsPayableTitle(row).cashRealizedAmount;
}

/**
 * Parcela do realizado gerencial (AP_SETTLED) SEM evidência de caixa:
 * baixa sem numerário, baixa forçada ou quitação sem valor pago informado.
 * Encerrada pelo motor oficial, mas não é saída de caixa.
 */
export function resolveFinanceApSettledWithoutCashAmount(row: FinanceApRulesInput): number {
  const normalized = normalizeAccountsPayableTitle(row);
  if (normalized.isCancelled) return 0;
  return roundMoney(Math.max(0, normalized.realizedAmount - normalized.cashRealizedAmount));
}

export const FINANCE_AP_CASH_FLOW_RULES_NOTE =
  "Fluxo de Caixa AP: agrupamento sempre por data de vencimento (dueDate). scheduleDate, competência e baixa são apenas informativos." as const;
