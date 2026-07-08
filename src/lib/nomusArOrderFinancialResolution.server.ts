import type { PrismaClient } from "@prisma/client";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  applyArOrderFinancialResolution,
  buildSalesOrderFinancialContext,
  indexSalesOrderFinancialContexts,
  parseSalesOrderParcelFromArDescription,
  type SalesOrderFinancialContext,
} from "./nomusArOrderFinancialResolution.js";
import {
  canonicalNomusOrderCodeKey,
  expandNomusOrderCodeLookupVariants,
} from "./salesOrderNomusSync.server.js";

type Db = Pick<PrismaClient, "salesOrder" | "salesOrderNfeLink">;

function collectLookupOrderCodes(rows: FinanceArDashboardRow[]): string[] {
  const codes = new Set<string>();
  for (const row of rows) {
    const parsed = parseSalesOrderParcelFromArDescription(row.description);
    if (parsed) {
      for (const variant of expandNomusOrderCodeLookupVariants(parsed.orderCode)) {
        codes.add(variant);
      }
    }
  }
  return [...codes];
}

function collectSourceInvoiceIds(rows: FinanceArDashboardRow[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.sourceInvoiceId != null && row.sourceInvoiceId > 0) ids.add(row.sourceInvoiceId);
  }
  return [...ids];
}

async function loadOrderContextsByCodes(
  db: Db,
  orderCodes: string[]
): Promise<Map<string, SalesOrderFinancialContext>> {
  if (orderCodes.length === 0) return new Map();
  const orders = await db.salesOrder.findMany({
    where: { orderCode: { in: orderCodes } },
    select: { id: true, orderCode: true, nomusRawResponse: true },
  });
  return indexSalesOrderFinancialContexts(orders);
}

async function loadOrderContextsByNfeIds(
  db: Db,
  nfeIds: number[]
): Promise<Map<number, SalesOrderFinancialContext>> {
  const map = new Map<number, SalesOrderFinancialContext>();
  if (nfeIds.length === 0) return map;

  const links = await db.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: nfeIds } },
    select: {
      nfeExternalId: true,
      salesOrder: {
        select: { id: true, orderCode: true, nomusRawResponse: true },
      },
    },
  });

  for (const link of links) {
    const order = link.salesOrder;
    if (!order) continue;
    map.set(link.nfeExternalId, buildSalesOrderFinancialContext(order.orderCode, order.id, order.nomusRawResponse));
  }

  return map;
}

function resolveContextForRow(
  row: FinanceArDashboardRow,
  byOrderCode: Map<string, SalesOrderFinancialContext>,
  byNfeId: Map<number, SalesOrderFinancialContext>
): SalesOrderFinancialContext | null {
  const parsed = parseSalesOrderParcelFromArDescription(row.description);
  if (parsed) {
    const key = canonicalNomusOrderCodeKey(parsed.orderCode);
    if (key && byOrderCode.has(key)) return byOrderCode.get(key)!;
  }
  if (row.sourceInvoiceId != null && byNfeId.has(row.sourceInvoiceId)) {
    return byNfeId.get(row.sourceInvoiceId)!;
  }
  return null;
}

/** Aplica resolução financeira por parcela do pedido em linhas AR gerenciais. */
export async function enrichFinanceArDashboardRowsWithOrderFinancialResolution(
  db: Db,
  rows: FinanceArDashboardRow[]
): Promise<FinanceArDashboardRow[]> {
  if (rows.length === 0) return rows;

  const [byOrderCode, byNfeId] = await Promise.all([
    loadOrderContextsByCodes(db, collectLookupOrderCodes(rows)),
    loadOrderContextsByNfeIds(db, collectSourceInvoiceIds(rows)),
  ]);

  return rows.map((row) => {
    const parsed = parseSalesOrderParcelFromArDescription(row.description);
    const context = resolveContextForRow(row, byOrderCode, byNfeId);
    return applyArOrderFinancialResolution(row, context, parsed);
  });
}
