import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import type { SalesOrderListReceivableInput } from "./salesOrderListPaymentSchedule.js";

export async function loadSalesOrderListReceivablesByNfeExternalIds(
  prisma: Pick<PrismaClient, "nomusAccountsReceivable">,
  nfeExternalIds: number[]
): Promise<Map<number, SalesOrderListReceivableInput[]>> {
  const unique = [...new Set(nfeExternalIds.filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, SalesOrderListReceivableInput[]>();
  if (unique.length === 0) return map;

  const rows = await prisma.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { in: unique } },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      sourceInvoiceNumber: true,
      dueDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
      settlementDate: true,
    },
    orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
  });

  for (const row of rows) {
    if (row.sourceInvoiceId == null) continue;
    const list = map.get(row.sourceInvoiceId) ?? [];
    list.push({
      externalId: row.externalId,
      sourceInvoiceId: row.sourceInvoiceId,
      sourceInvoiceNumber: row.sourceInvoiceNumber,
      dueDate: row.dueDate,
      amountReceivable: decimalToNumber(row.amountReceivable) ?? 0,
      amountReceived: decimalToNumber(row.amountReceived) ?? 0,
      balanceReceivable: decimalToNumber(row.balanceReceivable) ?? 0,
      settlementDate: row.settlementDate,
    });
    map.set(row.sourceInvoiceId, list);
  }

  return map;
}

export function collectReceivablesForOrderNfes(
  nfeExternalIds: number[],
  receivablesByNfeId: Map<number, SalesOrderListReceivableInput[]>
): SalesOrderListReceivableInput[] {
  const merged: SalesOrderListReceivableInput[] = [];
  const seen = new Set<number>();
  for (const nfeId of nfeExternalIds) {
    for (const row of receivablesByNfeId.get(nfeId) ?? []) {
      if (seen.has(row.externalId)) continue;
      seen.add(row.externalId);
      merged.push(row);
    }
  }
  return merged;
}
