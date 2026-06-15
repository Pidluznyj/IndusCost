/**
 * Regras saneadas de Contas a Pagar — fonte única para AP e Fluxo de Caixa.
 *
 * Baixas sem numerário / forçadas: tratadas como SETTLED com data efetiva = vencimento.
 */

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
  effectivePaymentDate: Date | null;
  effectiveStatus: FinanceApEffectiveStatus;
  settlementKind: FinanceApSettlementKind;
  amountPayable: number;
  amountPaid: number;
  realizedAmount: number;
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

export function normalizeAccountsPayableTitle(
  row: FinanceApRulesInput
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

  let effectivePaymentDate: Date | null = null;
  if (!isCancelled && (isSettled || amountPaid > 0)) {
    if (isSpecialWriteOff) {
      effectivePaymentDate = dueDate;
    } else {
      effectivePaymentDate = originalPaymentDate ?? originalSettlementDate ?? dueDate;
    }
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
    effectivePaymentDate,
    effectiveStatus,
    settlementKind,
    amountPayable,
    amountPaid,
    realizedAmount,
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

export function resolveFinanceApEffectivePaymentDate(row: FinanceApRulesInput): Date | null {
  return normalizeAccountsPayableTitle(row).effectivePaymentDate;
}

export function resolveFinanceApRealizedAmount(row: FinanceApRulesInput): number {
  return normalizeAccountsPayableTitle(row).realizedAmount;
}

export function resolveFinanceApOpenAmount(row: FinanceApRulesInput): number {
  return normalizeAccountsPayableTitle(row).openAmount;
}

export const FINANCE_AP_CASH_FLOW_RULES_NOTE =
  "Saídas realizadas seguem a regra saneada de Contas a Pagar. Baixas sem numerário ou forçadas são posicionadas pela data de vencimento." as const;
