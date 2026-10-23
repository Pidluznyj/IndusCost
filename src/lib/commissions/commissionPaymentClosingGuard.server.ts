/**
 * Carga da guarda de pagamento contra o fechamento oficial (ver
 * `commissionPaymentClosingGuard.ts`). Somente leitura; roda dentro da transação do lote.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./commission-money.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import {
  formatCommissionYearMonthLabel,
  listCommissionYearMonths,
  resolveReceiptNaturalYearMonth,
} from "./commissionCoverageCutover.js";
import {
  COMMISSION_PAYMENT_EXCEEDS_OFFICIAL_CLOSING,
  evaluatePaymentAgainstOfficialClosing,
  formatPaymentGuardViolations,
  type PaymentGuardRequest,
  type PaymentGuardResult,
} from "./commissionPaymentClosingGuard.js";

/** Liga/desliga a guarda (padrão: ligada). `false` volta ao pagamento só pelo registro. */
export function isCommissionPaymentClosingGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.COMMISSION_PAYMENT_CLOSING_GUARD_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/** Folga nas bordas do período: maior que qualquer fuso do Brasil (−02:00 a −05:00). */
const PERIOD_EDGE_TOLERANCE_MS = 12 * 60 * 60 * 1000;

/**
 * O lote chega com o período em UTC (filtro por mês: 01 00:00Z a 28 23:59Z) ou em hora
 * local do navegador (filtro por datas: 23:59:59 −03:00 do dia 28 vira 02:59Z do dia 1º).
 * Lido em UTC, o segundo puxaria a competência seguinte e exigiria um fechamento que não
 * pertence ao lote. As bordas entram com 12 h de folga; período de um dia usa o meio.
 */
export function competenceBoundsOfPeriod(periodStart: Date, periodEnd: Date): { start: Date; end: Date } {
  const startMs = periodStart.getTime();
  const endMs = periodEnd.getTime();
  const middle = startMs + (endMs - startMs) / 2;
  return {
    start: new Date(Math.min(startMs + PERIOD_EDGE_TOLERANCE_MS, middle)),
    end: new Date(Math.max(endMs - PERIOD_EDGE_TOLERANCE_MS, middle)),
  };
}

type GuardDb = Pick<
  PrismaClient | Prisma.TransactionClient,
  "commissionMonthlyClosing" | "commissionReceiptLedgerLine" | "commissionPaymentBatchItem"
>;

export async function evaluateCommissionPaymentBatchAgainstClosing(
  db: GuardDb,
  input: {
    commissionPersonId: string;
    periodStart: Date;
    periodEnd: Date;
    requested: readonly PaymentGuardRequest[];
    /** Lote sendo pago (não conta como "outro lote"). */
    excludeBatchId?: string | null;
  }
): Promise<PaymentGuardResult> {
  const bounds = competenceBoundsOfPeriod(input.periodStart, input.periodEnd);
  const start = resolveReceiptNaturalYearMonth(bounds.start);
  const end = resolveReceiptNaturalYearMonth(bounds.end);
  if (!start || !end) {
    return { ok: false, violations: ["período do lote inválido"], orders: [] };
  }
  const months = listCommissionYearMonths(start, end);
  const [closings, ledgerLines, committedItems] = await Promise.all([
    db.commissionMonthlyClosing.findMany({
      where: { status: "CLOSED", OR: months.map((month) => ({ year: month.year, month: month.month })) },
      select: { year: true, month: true },
    }),
    db.commissionReceiptLedgerLine.findMany({
      where: {
        canonicalSellerId: input.commissionPersonId,
        status: "COMMISSIONABLE",
        closing: { status: "CLOSED" },
        OR: [{ year: { lt: end.year } }, { year: end.year, month: { lte: end.month } }],
      },
      select: { canonicalSellerId: true, nomusOrderId: true, orderCode: true, status: true, releasedCommissionAmount: true },
    }),
    db.commissionPaymentBatchItem.findMany({
      where: {
        status: { not: "CANCELLED" },
        batch: {
          commissionPersonId: input.commissionPersonId,
          status: { not: "CANCELLED" },
          ...(input.excludeBatchId ? { id: { not: input.excludeBatchId } } : {}),
        },
      },
      select: {
        status: true,
        amountToPay: true,
        amountPaid: true,
        commissionRecord: { select: { nomusOrderId: true, orderCode: true } },
      },
    }),
  ]);
  const closed = new Set(closings.map((row) => `${row.year}-${row.month}`));
  return evaluatePaymentAgainstOfficialClosing({
    commissionPersonId: input.commissionPersonId,
    ledgerLines: ledgerLines.map((line) => ({
      canonicalSellerId: line.canonicalSellerId,
      nomusOrderId: line.nomusOrderId,
      orderCode: line.orderCode,
      status: line.status,
      releasedCommissionAmount: decimalToNumber(line.releasedCommissionAmount),
    })),
    committed: committedItems.map((item) => ({
      nomusOrderId: item.commissionRecord.nomusOrderId,
      orderCode: item.commissionRecord.orderCode,
      amount: decimalToNumber(item.status === "PAID" ? item.amountPaid : item.amountToPay),
    })),
    requested: input.requested,
    openCompetences: months.filter((month) => !closed.has(`${month.year}-${month.month}`)).map(formatCommissionYearMonthLabel),
  });
}

/** Recusa (CommissionValidationError) o lote que pagaria além do fechamento oficial. */
export async function assertCommissionPaymentWithinOfficialClosing(
  db: GuardDb,
  input: Parameters<typeof evaluateCommissionPaymentBatchAgainstClosing>[1]
): Promise<void> {
  if (!isCommissionPaymentClosingGuardEnabled()) return;
  const result = await evaluateCommissionPaymentBatchAgainstClosing(db, input);
  if (!result.ok) {
    throw new CommissionValidationError(COMMISSION_PAYMENT_EXCEEDS_OFFICIAL_CLOSING, formatPaymentGuardViolations(result.violations));
  }
}
