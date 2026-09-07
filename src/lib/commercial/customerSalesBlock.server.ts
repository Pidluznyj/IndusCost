/**
 * Carga em lote da trava de venda (Prisma). Sem N+1: 1 query de pedidos + 1 de AR.
 */

import type { PrismaClient } from "@prisma/client";
import { mapPrismaRowToFinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { resolveEffectiveNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { canViewFinanceAccountsReceivable } from "@/src/lib/financeAccountsReceivablePermissions.js";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";
import {
  buildCustomerSalesBlockStatus,
  CustomerSalesBlockedError,
  resolveUniqueNomusPersonId,
  toPublicCustomerSalesBlock,
  type CustomerSalesBlockArTitle,
  type CustomerSalesBlockPublic,
} from "./customerSalesBlock.js";

export type CustomerSalesBlockDb = Pick<PrismaClient, "salesOrder" | "nomusAccountsReceivable">;

const AR_SELECT = {
  externalId: true,
  companyName: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  comments: true,
  dueDate: true,
  competenceDate: true,
  settlementDate: true,
  amountReceivable: true,
  amountReceived: true,
  balanceReceivable: true,
  paymentMethodId: true,
  paymentMethodName: true,
  bankAccountName: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  suspendCollection: true,
  status: true,
  syncedAt: true,
  sourcePresenceStatus: true,
} as const;

export function canExposeCustomerSalesBlockFinancialDetails(
  auth: Pick<AppAuthContext, "permissions" | "effectivePermissions"> | null | undefined
): boolean {
  if (!auth) return false;
  return canViewFinanceAccountsReceivable({
    hasPermission: (key) =>
      auth.permissions.includes(key) || auth.effectivePermissions.includes(key),
  });
}

export async function loadCustomerSalesBlockStatuses(
  prisma: CustomerSalesBlockDb,
  customerIds: readonly string[],
  now: Date = new Date()
): Promise<Map<string, ReturnType<typeof buildCustomerSalesBlockStatus>>> {
  const result = new Map<string, ReturnType<typeof buildCustomerSalesBlockStatus>>();
  if (customerIds.length === 0) return result;

  const orders = await prisma.salesOrder.findMany({
    where: { customerId: { in: [...customerIds] } },
    select: { customerId: true, externalCustomerId: true },
  });

  const idsByCustomer = new Map<string, Array<number | null>>();
  for (const id of customerIds) idsByCustomer.set(id, []);
  for (const order of orders) {
    const list = idsByCustomer.get(order.customerId);
    if (list) list.push(order.externalCustomerId);
  }

  const resolutions = new Map<string, ReturnType<typeof resolveUniqueNomusPersonId>>();
  const personIds: number[] = [];
  for (const [customerId, ids] of idsByCustomer) {
    const resolution = resolveUniqueNomusPersonId(ids);
    resolutions.set(customerId, resolution);
    if (resolution.kind === "RESOLVED") personIds.push(resolution.personId);
  }

  const uniquePersonIds = [...new Set(personIds)];
  const arRows =
    uniquePersonIds.length === 0
      ? []
      : await prisma.nomusAccountsReceivable.findMany({
          where: { personId: { in: uniquePersonIds } },
          select: AR_SELECT,
        });

  const titles: CustomerSalesBlockArTitle[] = arRows.map((row) => ({
    ...mapPrismaRowToFinanceArDashboardRow(row),
    paymentMethodId: row.paymentMethodId ?? null,
  }));
  const syncCutoff = resolveEffectiveNomusArReportSyncCutoff(titles, null);

  for (const customerId of customerIds) {
    result.set(
      customerId,
      buildCustomerSalesBlockStatus({
        personResolution: resolutions.get(customerId) ?? { kind: "MISSING" },
        titles,
        today: now,
        evaluatedAt: now,
        syncCutoff,
      })
    );
  }
  return result;
}

export async function resolveCustomerSalesBlockStatus(
  prisma: CustomerSalesBlockDb,
  customerId: string,
  now: Date = new Date()
) {
  const map = await loadCustomerSalesBlockStatuses(prisma, [customerId], now);
  return (
    map.get(customerId) ??
    buildCustomerSalesBlockStatus({
      personResolution: { kind: "MISSING" },
      titles: [],
      today: now,
    })
  );
}

export async function attachCustomerSalesBlocks<T extends { id: string }>(
  prisma: CustomerSalesBlockDb,
  customers: T[],
  options: { includeFinancialDetails: boolean; now?: Date }
): Promise<Array<T & { salesBlock: CustomerSalesBlockPublic }>> {
  const statuses = await loadCustomerSalesBlockStatuses(
    prisma,
    customers.map((c) => c.id),
    options.now
  );
  return customers.map((customer) => {
    const status =
      statuses.get(customer.id) ??
      buildCustomerSalesBlockStatus({
        personResolution: { kind: "MISSING" },
        titles: [],
        today: options.now ?? new Date(),
      });
    return {
      ...customer,
      salesBlock: toPublicCustomerSalesBlock(status, options.includeFinancialDetails),
    };
  });
}

export async function assertCustomerSalesAllowed(
  prisma: CustomerSalesBlockDb,
  customerId: string,
  now: Date = new Date()
): Promise<void> {
  const status = await resolveCustomerSalesBlockStatus(prisma, customerId, now);
  if (status.blocked) {
    throw new CustomerSalesBlockedError();
  }
}

export async function attachSalesBlockToNestedCustomers<
  T extends { customerId: string; Customer?: { id: string } | null },
>(
  prisma: CustomerSalesBlockDb,
  records: T[],
  options: { includeFinancialDetails: boolean; now?: Date }
): Promise<T[]> {
  const ids = [...new Set(records.map((row) => row.customerId).filter(Boolean))];
  const statuses = await loadCustomerSalesBlockStatuses(prisma, ids, options.now);
  return records.map((row) => {
    const status =
      statuses.get(row.customerId) ??
      buildCustomerSalesBlockStatus({
        personResolution: { kind: "MISSING" },
        titles: [],
        today: options.now ?? new Date(),
      });
    const salesBlock = toPublicCustomerSalesBlock(status, options.includeFinancialDetails);
    if (!row.Customer) return row;
    return { ...row, Customer: { ...row.Customer, salesBlock } };
  });
}
