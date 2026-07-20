/**
 * Filtro de status de CR oficial (Contas a Receber) na listagem de Pedidos.
 * Cadeia canônica: SalesOrder → SalesOrderNfeLink.nfeExternalId →
 * NomusAccountsReceivable.sourceInvoiceId.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";

/** Tolerância alinhada ao relatório comercial / auditoria financeira. */
export const SALES_ORDER_LIST_CR_OPEN_TOLERANCE = 0.01;

export const SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES = [
  "open",
  "settled",
  "none",
] as const;

export type SalesOrderListReceivableStatus =
  (typeof SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES)[number];

export const RECEIVABLE_STATUS_FILTER_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "", label: "Todos" },
  { value: "open", label: "CR em aberto" },
  { value: "settled", label: "CR quitado" },
  { value: "none", label: "Sem CR" },
];

export function parseSalesOrderListReceivableStatusParam(
  value: unknown
): SalesOrderListReceivableStatus | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (
    (SALES_ORDER_LIST_RECEIVABLE_STATUS_VALUES as readonly string[]).includes(
      token
    )
  ) {
    return token as SalesOrderListReceivableStatus;
  }
  return null;
}

export function andSalesOrderListWhere(
  base: Prisma.SalesOrderWhereInput,
  extra: Prisma.SalesOrderWhereInput | null | undefined
): Prisma.SalesOrderWhereInput {
  if (!extra || Object.keys(extra).length === 0) return base;
  if (!base || Object.keys(base).length === 0) return extra;
  return { AND: [base, extra] };
}

export function buildSalesOrderListReceivableStatusWhereFromSets(
  status: SalesOrderListReceivableStatus,
  sets: { withAnyCr: ReadonlySet<string>; withOpenCr: ReadonlySet<string> }
): Prisma.SalesOrderWhereInput {
  if (status === "open") {
    return { id: { in: [...sets.withOpenCr] } };
  }
  if (status === "settled") {
    const settledIds: string[] = [];
    for (const id of sets.withAnyCr) {
      if (!sets.withOpenCr.has(id)) settledIds.push(id);
    }
    return { id: { in: settledIds } };
  }
  // none: pedidos sem CR oficial vinculado via NF
  if (sets.withAnyCr.size === 0) return {};
  return { id: { notIn: [...sets.withAnyCr] } };
}

/**
 * Agrega pedidos com CR (qualquer) e com saldo em aberto via NF vinculada.
 */
export async function loadSalesOrderOfficialCrOrderIdSets(
  prisma: PrismaClient
): Promise<{ withAnyCr: Set<string>; withOpenCr: Set<string> }> {
  const receivables = await prisma.nomusAccountsReceivable.findMany({
    where: { sourceInvoiceId: { not: null } },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      balanceReceivable: true,
    },
  });

  const openByNfe = new Map<number, number>();
  const anyCrNfeIds = new Set<number>();
  const seenReceivable = new Set<number>();

  for (const row of receivables) {
    if (row.sourceInvoiceId == null) continue;
    if (seenReceivable.has(row.externalId)) continue;
    seenReceivable.add(row.externalId);
    anyCrNfeIds.add(row.sourceInvoiceId);
    const open = decimalToNumber(row.balanceReceivable) ?? 0;
    if (open > SALES_ORDER_LIST_CR_OPEN_TOLERANCE) {
      openByNfe.set(
        row.sourceInvoiceId,
        (openByNfe.get(row.sourceInvoiceId) ?? 0) + open
      );
    }
  }

  if (anyCrNfeIds.size === 0) {
    return { withAnyCr: new Set(), withOpenCr: new Set() };
  }

  const links = await prisma.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: [...anyCrNfeIds] } },
    select: { salesOrderId: true, nfeExternalId: true },
  });

  const withAnyCr = new Set<string>();
  const openByOrder = new Map<string, number>();
  for (const link of links) {
    withAnyCr.add(link.salesOrderId);
    const nfeOpen = openByNfe.get(link.nfeExternalId) ?? 0;
    if (nfeOpen > 0) {
      openByOrder.set(
        link.salesOrderId,
        (openByOrder.get(link.salesOrderId) ?? 0) + nfeOpen
      );
    }
  }

  const withOpenCr = new Set<string>();
  for (const [orderId, openSum] of openByOrder) {
    if (openSum > SALES_ORDER_LIST_CR_OPEN_TOLERANCE) {
      withOpenCr.add(orderId);
    }
  }

  return { withAnyCr, withOpenCr };
}

export async function resolveSalesOrderListReceivableStatusWhere(
  prisma: PrismaClient,
  status: SalesOrderListReceivableStatus | null
): Promise<Prisma.SalesOrderWhereInput | null> {
  if (!status) return null;
  const sets = await loadSalesOrderOfficialCrOrderIdSets(prisma);
  return buildSalesOrderListReceivableStatusWhereFromSets(status, sets);
}
