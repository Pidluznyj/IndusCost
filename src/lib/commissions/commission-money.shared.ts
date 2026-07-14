/** Helpers monetários puros — sem Prisma (seguros para frontend). */

/** Arredonda valor monetário para 2 casas (evita ponto flutuante). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    roundMoney(value)
  );
}

/**
 * base = quantidade * valorUnitario - desconto + acrescimo
 */
export function computeItemBaseAmount(input: {
  quantity: number;
  unitPrice: number;
  discount?: number;
  surcharge?: number;
}): number {
  const qty = Number.isFinite(input.quantity) ? input.quantity : 0;
  const unit = Number.isFinite(input.unitPrice) ? input.unitPrice : 0;
  const discount = Number.isFinite(input.discount ?? 0) ? (input.discount ?? 0) : 0;
  const surcharge = Number.isFinite(input.surcharge ?? 0) ? (input.surcharge ?? 0) : 0;
  return roundMoney(qty * unit - discount + surcharge);
}

export function computeCommissionAmount(baseAmount: number, ratePercent: number): number {
  const base = roundMoney(baseAmount);
  const rate = Number.isFinite(ratePercent) ? ratePercent : 0;
  return roundMoney(base * (rate / 100));
}

export type ProportionalAllocationPart = {
  key: string;
  weight: number;
};

export type ProportionalAllocationResult = {
  key: string;
  amount: number;
  percent: number;
};

/**
 * Rateio proporcional de um total entre partes com pesos positivos.
 * Ajusta centavos residuais na última parcela não nula.
 */
export function allocateProportional(
  totalAmount: number,
  parts: ProportionalAllocationPart[]
): ProportionalAllocationResult[] {
  const total = roundMoney(totalAmount);
  if (parts.length === 0) return [];
  const weights = parts.map((p) => (Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) {
    const even = roundMoney(total / parts.length);
    let allocated = 0;
    return parts.map((p, idx) => {
      const amount = idx === parts.length - 1 ? roundMoney(total - allocated) : even;
      allocated = roundMoney(allocated + amount);
      return { key: p.key, amount, percent: roundMoney((amount / total) * 100) || 0 };
    });
  }

  let allocated = 0;
  const results: ProportionalAllocationResult[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1;
    const raw = isLast ? roundMoney(total - allocated) : roundMoney((total * weights[i]) / weightSum);
    allocated = roundMoney(allocated + raw);
    results.push({
      key: parts[i].key,
      amount: raw,
      percent: total > 0 ? roundMoney((raw / total) * 100) : 0,
    });
  }
  return results;
}

/**
 * Auditoria: recebimento bruto > valor original do CR (juros/multa/acréscimos).
 * Não entram na base comissionável.
 */
export const RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL =
  "RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL";

/**
 * Auditoria: título quitado (saldo ~0) com recebido < original — possível desconto/abatimento.
 * Não infere juros negativo; apenas sinaliza.
 */
export const RECEIVABLE_DISCOUNT_DETECTED = "RECEIVABLE_DISCOUNT_DETECTED";

export type ReceivableCommissionPrincipalBreakdown = {
  /** Valor original do título (`amountReceivable` / `receivableNominalAmount`). */
  receivableOriginalAmount: number;
  /** Valor recebido bruto (pode incluir juros/multa). */
  receivedGrossAmount: number;
  /** Principal comissionável = min(recebido, original). */
  commissionPrincipalAmount: number;
  /** max(0, recebido − original) — encargos ignorados na comissão. */
  ignoredFinancialChargesAmount: number;
  /** principal / original, capped em 1. */
  releaseRatio: number;
  auditFlags: string[];
};

/**
 * Resolve a base comissionável do título CR.
 * Recebido é gatilho/proporção; nunca aumenta a base além do valor original.
 */
export function resolveReceivableCommissionPrincipal(input: {
  receivableOriginalAmount: number;
  receivedAmount: number;
  /** Saldo em aberto opcional — usado só para flag de desconto. */
  openBalance?: number | null;
}): ReceivableCommissionPrincipalBreakdown {
  const original = roundMoney(Math.max(0, input.receivableOriginalAmount));
  const received = roundMoney(Math.max(0, input.receivedAmount));
  const principal = roundMoney(Math.min(received, original > 0 ? original : received));
  const ignored = original > 0 ? roundMoney(Math.max(0, received - original)) : 0;
  const releaseRatio = original > 0 ? Math.min(1, principal / original) : 0;
  const flags: string[] = [];
  if (ignored > 0.009) {
    flags.push(RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL);
  }
  const open =
    input.openBalance === undefined || input.openBalance === null
      ? null
      : roundMoney(Math.max(0, input.openBalance));
  if (
    open != null &&
    open <= 0.009 &&
    received > 0 &&
    original > 0 &&
    received + 0.009 < original
  ) {
    flags.push(RECEIVABLE_DISCOUNT_DETECTED);
  }
  return {
    receivableOriginalAmount: original,
    receivedGrossAmount: received,
    commissionPrincipalAmount: principal,
    ignoredFinancialChargesAmount: ignored,
    releaseRatio,
    auditFlags: flags,
  };
}

/**
 * Comissão liberada = expected × (principal / original), nunca acima do expected.
 * Usa min(recebido, original) como numerador da proporção.
 */
export function computeCommissionReleasedFromReceivablePrincipal(input: {
  commissionExpectedAmount: number;
  receivableOriginalAmount: number;
  receivedAmount: number;
}): number {
  const expected = roundMoney(input.commissionExpectedAmount);
  if (expected <= 0) return 0;
  const breakdown = resolveReceivableCommissionPrincipal({
    receivableOriginalAmount: input.receivableOriginalAmount,
    receivedAmount: input.receivedAmount,
  });
  return roundMoney(Math.min(expected, expected * breakdown.releaseRatio));
}

/**
 * Liberação proporcional ao principal do título (não ao recebido bruto com juros).
 * Retorna o *delta* incremental desde `alreadyReleased`.
 */
export function computeReleasedAmountForReceivable(input: {
  commissionAmount: number;
  alreadyReleased: number;
  receivableAmount: number;
  receivedAmount: number;
}): number {
  const commission = roundMoney(input.commissionAmount);
  const already = roundMoney(input.alreadyReleased);
  if (commission <= 0) return 0;

  const targetReleased = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: commission,
    receivableOriginalAmount: input.receivableAmount,
    receivedAmount: input.receivedAmount,
  });
  const delta = roundMoney(targetReleased - already);
  if (delta <= 0) return 0;
  const maxRemaining = roundMoney(commission - already);
  return roundMoney(Math.min(delta, maxRemaining));
}

export function clampPaymentAmount(amount: number, maxAllowed: number): number {
  const a = roundMoney(amount);
  const max = roundMoney(maxAllowed);
  if (a <= 0) return 0;
  return roundMoney(Math.min(a, max));
}
