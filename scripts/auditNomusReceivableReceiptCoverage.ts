/**
 * Diagnóstico READ-ONLY: AR × NomusReceivableReceipt × CommissionReceivableSchedule.
 *
 * Não grava. Não sincroniza. Vínculo só por externalId.
 *
 *   npm run audit:nomus:receivable-receipt-coverage -- --ids 18964,19135 --month 2026-09
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  classifyReceivableReceiptCoverage,
  type ReceiptCoverageEvent,
} from "@/src/lib/nomus/nomusReceivableReceiptCoverage.js";

const prisma = new PrismaClient();

function parseCli(argv: string[]): { ids: number[]; month: string | null } {
  let ids: number[] = [];
  let month: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--ids" && argv[i + 1]) {
      ids = argv[i + 1]!
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isInteger(id));
      i += 1;
    } else if (argv[i] === "--month" && argv[i + 1]) {
      month = /^\d{4}-\d{2}$/.test(argv[i + 1]!) ? argv[i + 1]! : null;
      i += 1;
    }
  }
  return { ids, month };
}

function money(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const { ids, month } = parseCli(process.argv.slice(2));
  if (ids.length === 0) {
    throw new Error("Informe --ids 18964,19135. Nada foi gravado.");
  }

  const [receivables, receipts, schedules] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      where: { externalId: { in: ids } },
      select: {
        externalId: true,
        sourceInvoiceNumber: true,
        personName: true,
        dueDate: true,
        amountReceivable: true,
        amountReceived: true,
        balanceReceivable: true,
        settlementDate: true,
        syncedAt: true,
      },
    }),
    prisma.nomusReceivableReceipt.findMany({
      where: { receivableExternalId: { in: ids } },
      select: {
        externalId: true,
        receivableExternalId: true,
        receiptDate: true,
        receivedAmount: true,
        lateFeeInterestAmount: true,
        discountAmount: true,
        bankFeeAmount: true,
        closesReceivable: true,
        createdAtNomus: true,
        modifiedAtNomus: true,
        syncedAt: true,
      },
      orderBy: { receiptDate: "asc" },
    }),
    prisma.commissionReceivableSchedule.findMany({
      where: { receivableId: { in: ids } },
      select: {
        id: true,
        receivableId: true,
        orderSnapshotId: true,
        nfeId: true,
        installmentNumber: true,
        receivableNominalAmount: true,
        receivableSharePercent: true,
        scheduledCommissionAmount: true,
        status: true,
      },
    }),
  ]);

  const arById = new Map(receivables.map((row) => [row.externalId, row]));
  const receiptsById = new Map<number, typeof receipts>();
  for (const row of receipts) {
    const list = receiptsById.get(row.receivableExternalId) ?? [];
    list.push(row);
    receiptsById.set(row.receivableExternalId, list);
  }
  const schedulesById = new Map<number, typeof schedules>();
  for (const row of schedules) {
    const list = schedulesById.get(row.receivableId) ?? [];
    list.push(row);
    schedulesById.set(row.receivableId, list);
  }

  const rows = ids.map((id) => {
    const ar = arById.get(id) ?? null;
    const events = receiptsById.get(id) ?? [];
    const scheduleRows = schedulesById.get(id) ?? [];
    const coverageEvents: ReceiptCoverageEvent[] = events.map((row) => ({
      externalId: row.externalId,
      receiptDate: toCivilDateKey(row.receiptDate) ?? "",
      receivedAmount: money(row.receivedAmount),
    }));
    const classification = classifyReceivableReceiptCoverage({
      receivableExternalId: id,
      ar: ar
        ? {
            amountReceivable: money(ar.amountReceivable),
            amountReceived: money(ar.amountReceived),
            balanceReceivable: ar.balanceReceivable == null ? null : money(ar.balanceReceivable),
            settlementDate: toCivilDateKey(ar.settlementDate),
          }
        : null,
      receipts: coverageEvents,
      scheduleCount: scheduleRows.length,
      expectedCompetenceMonth: month,
    });
    return {
      ...classification,
      ar: ar
        ? {
            nf: ar.sourceInvoiceNumber,
            cliente: ar.personName,
            vencimento: toCivilDateKey(ar.dueDate),
            valorOriginal: money(ar.amountReceivable),
            amountReceived: money(ar.amountReceived),
            saldo: ar.balanceReceivable == null ? null : money(ar.balanceReceivable),
            settlementDate: toCivilDateKey(ar.settlementDate),
            syncedAt: ar.syncedAt.toISOString(),
          }
        : null,
      receipts: events.map((row) => ({
        externalId: row.externalId,
        receiptDate: toCivilDateKey(row.receiptDate),
        receivedAmount: money(row.receivedAmount),
        lateFeeInterestAmount: row.lateFeeInterestAmount == null ? null : money(row.lateFeeInterestAmount),
        discountAmount: row.discountAmount == null ? null : money(row.discountAmount),
        bankFeeAmount: row.bankFeeAmount == null ? null : money(row.bankFeeAmount),
        closesReceivable: row.closesReceivable,
        createdAtNomus: row.createdAtNomus?.toISOString() ?? null,
        modifiedAtNomus: row.modifiedAtNomus?.toISOString() ?? null,
        syncedAt: row.syncedAt.toISOString(),
      })),
      schedules: scheduleRows.map((row) => ({
        id: row.id,
        snapshotId: row.orderSnapshotId,
        nfeId: row.nfeId,
        parcela: row.installmentNumber,
        nominal: money(row.receivableNominalAmount),
        sharePercent: money(row.receivableSharePercent),
        commissionAmount: money(row.scheduledCommissionAmount),
        status: row.status,
      })),
    };
  });

  console.log(JSON.stringify({ readOnly: true, month, rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
