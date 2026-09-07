/**
 * Carga em lote da trava de venda (Prisma). Sem N+1, para N clientes:
 *   (0 ou 1) consulta de Customer — só para clientes cujo
 *            nomusExternalPersonId não veio junto com a linha já selecionada;
 *   1 consulta de SalesOrder (evidência de consistência da identidade);
 *   1 consulta de AR (somente personIds resolvidos).
 */

import type { PrismaClient } from "@prisma/client";
import { mapPrismaRowToFinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { resolveEffectiveNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { canViewFinanceAccountsReceivable } from "@/src/lib/financeAccountsReceivablePermissions.js";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";
import {
  buildCustomerSalesBlockStatus,
  CustomerSalesBlockedError,
  resolveCustomerFinancialIdentity,
  toPublicCustomerSalesBlock,
  type CustomerFinancialIdentityResolution,
  type CustomerSalesBlockArTitle,
  type CustomerSalesBlockPublic,
  type CustomerSalesBlockStatus,
} from "./customerSalesBlock.js";

export type CustomerSalesBlockDb = Pick<PrismaClient, "customer" | "salesOrder" | "nomusAccountsReceivable">;

/** Referência de cliente: id, ou linha já carregada com o ID Nomus. */
export type CustomerSalesBlockCustomerRef =
  | string
  | { id: string; nomusExternalPersonId?: number | null };

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

function unresolvedStatus(now: Date): CustomerSalesBlockStatus {
  return buildCustomerSalesBlockStatus({
    identity: { kind: "MISSING", salesOrderPersonIds: [] },
    titles: [],
    today: now,
    evaluatedAt: now,
  });
}

/**
 * Identidade financeira em lote. `Customer.nomusExternalPersonId` é a
 * autoridade; `SalesOrder.externalCustomerId` só entra como evidência de
 * consistência (uma consulta set-based para todos os clientes).
 */
export async function loadCustomerFinancialIdentities(
  prisma: CustomerSalesBlockDb,
  refs: readonly CustomerSalesBlockCustomerRef[]
): Promise<Map<string, CustomerFinancialIdentityResolution>> {
  const nomusIdByCustomer = new Map<string, number | null>();
  const toLoad: string[] = [];
  for (const ref of refs) {
    if (typeof ref === "string") {
      if (!nomusIdByCustomer.has(ref)) toLoad.push(ref);
      continue;
    }
    if (ref.nomusExternalPersonId === undefined) {
      if (!nomusIdByCustomer.has(ref.id)) toLoad.push(ref.id);
      continue;
    }
    nomusIdByCustomer.set(ref.id, ref.nomusExternalPersonId);
  }
  const missing = [...new Set(toLoad.filter((id) => !nomusIdByCustomer.has(id)))];
  if (missing.length > 0) {
    const rows = await prisma.customer.findMany({
      where: { id: { in: missing } },
      select: { id: true, nomusExternalPersonId: true },
    });
    for (const row of rows) nomusIdByCustomer.set(row.id, row.nomusExternalPersonId);
  }

  const customerIds = [...new Set(refs.map((ref) => (typeof ref === "string" ? ref : ref.id)))];
  const orders =
    customerIds.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: { customerId: { in: customerIds } },
          select: { customerId: true, externalCustomerId: true },
        });
  const orderIdsByCustomer = new Map<string, Array<number | null>>();
  for (const order of orders) {
    const list = orderIdsByCustomer.get(order.customerId) ?? [];
    list.push(order.externalCustomerId);
    orderIdsByCustomer.set(order.customerId, list);
  }

  const result = new Map<string, CustomerFinancialIdentityResolution>();
  for (const customerId of customerIds) {
    result.set(
      customerId,
      resolveCustomerFinancialIdentity({
        // Cliente inexistente no banco: sem identidade → fail closed.
        nomusExternalPersonId: nomusIdByCustomer.get(customerId) ?? null,
        salesOrderExternalCustomerIds: orderIdsByCustomer.get(customerId) ?? [],
      })
    );
  }
  return result;
}

export async function loadCustomerSalesBlockStatuses(
  prisma: CustomerSalesBlockDb,
  refs: readonly CustomerSalesBlockCustomerRef[],
  now: Date = new Date()
): Promise<Map<string, CustomerSalesBlockStatus>> {
  const result = new Map<string, CustomerSalesBlockStatus>();
  if (refs.length === 0) return result;

  const identities = await loadCustomerFinancialIdentities(prisma, refs);

  const personIds: number[] = [];
  for (const identity of identities.values()) {
    if (identity.kind === "RESOLVED") personIds.push(identity.personId);
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

  for (const [customerId, identity] of identities) {
    result.set(
      customerId,
      buildCustomerSalesBlockStatus({
        identity,
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
  customer: CustomerSalesBlockCustomerRef,
  now: Date = new Date()
): Promise<CustomerSalesBlockStatus> {
  const map = await loadCustomerSalesBlockStatuses(prisma, [customer], now);
  const id = typeof customer === "string" ? customer : customer.id;
  return map.get(id) ?? unresolvedStatus(now);
}

export async function attachCustomerSalesBlocks<
  T extends { id: string; nomusExternalPersonId?: number | null },
>(
  prisma: CustomerSalesBlockDb,
  customers: T[],
  options: { includeFinancialDetails: boolean; now?: Date }
): Promise<Array<T & { salesBlock: CustomerSalesBlockPublic }>> {
  const now = options.now ?? new Date();
  const statuses = await loadCustomerSalesBlockStatuses(prisma, customers, now);
  return customers.map((customer) => ({
    ...customer,
    salesBlock: toPublicCustomerSalesBlock(
      statuses.get(customer.id) ?? unresolvedStatus(now),
      options.includeFinancialDetails
    ),
  }));
}

/**
 * Hard block da criação local de venda. Rejeita tanto inadimplência provada
 * quanto identidade financeira não validável (fail closed), cada uma com o
 * seu código de erro.
 */
export async function assertCustomerSalesAllowed(
  prisma: CustomerSalesBlockDb,
  customer: CustomerSalesBlockCustomerRef,
  now: Date = new Date()
): Promise<void> {
  const status = await resolveCustomerSalesBlockStatus(prisma, customer, now);
  if (status.blocked) {
    throw new CustomerSalesBlockedError(status.reason ?? "FINANCIAL_IDENTITY_UNRESOLVED");
  }
}

export type WithNestedSalesBlock<T extends { Customer?: object | null }> = T & {
  Customer?: (NonNullable<T["Customer"]> & { salesBlock: CustomerSalesBlockPublic }) | null;
};

export async function attachSalesBlockToNestedCustomers<
  T extends { customerId: string; Customer?: { id: string; nomusExternalPersonId?: number | null } | null },
>(
  prisma: CustomerSalesBlockDb,
  records: T[],
  options: { includeFinancialDetails: boolean; now?: Date }
): Promise<Array<WithNestedSalesBlock<T>>> {
  const now = options.now ?? new Date();
  const refsById = new Map<string, CustomerSalesBlockCustomerRef>();
  for (const row of records) {
    if (!row.customerId) continue;
    const nested = row.Customer;
    // Linha aninhada com o ID Nomus já carregado evita a consulta de Customer.
    if (nested && nested.id === row.customerId && nested.nomusExternalPersonId !== undefined) {
      refsById.set(row.customerId, { id: nested.id, nomusExternalPersonId: nested.nomusExternalPersonId });
    } else if (!refsById.has(row.customerId)) {
      refsById.set(row.customerId, row.customerId);
    }
  }
  const statuses = await loadCustomerSalesBlockStatuses(prisma, [...refsById.values()], now);
  return records.map((row) => {
    if (!row.Customer) return row as WithNestedSalesBlock<T>;
    const salesBlock = toPublicCustomerSalesBlock(
      statuses.get(row.customerId) ?? unresolvedStatus(now),
      options.includeFinancialDetails
    );
    return { ...row, Customer: { ...row.Customer, salesBlock } } as WithNestedSalesBlock<T>;
  });
}
