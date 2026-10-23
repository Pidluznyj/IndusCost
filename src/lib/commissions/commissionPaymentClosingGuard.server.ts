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
  const start = resolveReceiptNaturalYearMonth(input.periodStart);
  const end = resolveReceiptNaturalYearMonth(input.periodEnd);
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
