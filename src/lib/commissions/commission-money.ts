import { Prisma } from "@prisma/client";

/** Converte Decimal Prisma ou número para number finito. */
export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && "toNumber" in value) {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Arredonda valor monetário para 2 casas (evita ponto flutuante). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(roundMoney(value));
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

/** Liberação proporcional ao recebido sobre o título. */
export function computeReleasedAmountForReceivable(input: {
  commissionAmount: number;
  alreadyReleased: number;
  receivableAmount: number;
  receivedAmount: number;
}): number {
  const commission = roundMoney(input.commissionAmount);
  const already = roundMoney(input.alreadyReleased);
  const receivable = roundMoney(input.receivableAmount);
  const received = roundMoney(input.receivedAmount);
  if (commission <= 0 || receivable <= 0 || received <= 0) return 0;

  const targetReleased = roundMoney(commission * (received / receivable));
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
