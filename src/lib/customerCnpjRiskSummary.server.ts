/**
 * Score CNPJ no grid de Clientes — carga em lote (Prisma).
 *
 * UMA consulta para a página inteira de clientes (sem N+1): todas as
 * `CustomerCnpjLookup` vinculadas por `customerId` OU com o mesmo CNPJ
 * normalizado; a escolha da mais recente por cliente é do motor puro.
 * Somente leitura — nenhuma consulta externa é disparada pelo grid.
 */

import type { PrismaClient } from "@prisma/client";
import {
  normalizeCustomerTaxIdsForLookup,
  pickLatestCustomerCnpjLookups,
  type CustomerCnpjRiskSummary,
  type CustomerIdentityForRisk,
} from "./customerCnpjRiskSummary.js";

export type CustomerCnpjRiskDb = Pick<PrismaClient, "customerCnpjLookup">;

const LOOKUP_SELECT = {
  id: true,
  cnpj: true,
  customerId: true,
  source: true,
  riskScore: true,
  riskVerdict: true,
  riskDetails: true,
  fetchedAt: true,
  expiresAt: true,
} as const;

export async function loadCustomerCnpjRiskSummaries(
  prisma: CustomerCnpjRiskDb,
  customers: readonly CustomerIdentityForRisk[],
  now: Date = new Date()
): Promise<Map<string, CustomerCnpjRiskSummary>> {
  if (customers.length === 0) return new Map();
  const ids = customers.map((c) => c.id);
  const cnpjs = normalizeCustomerTaxIdsForLookup(customers);
  const rows = await prisma.customerCnpjLookup.findMany({
    where: {
      OR: [{ customerId: { in: ids } }, ...(cnpjs.length ? [{ cnpj: { in: cnpjs } }] : [])],
    },
    select: LOOKUP_SELECT,
    orderBy: { fetchedAt: "desc" },
  });
  return pickLatestCustomerCnpjLookups(customers, rows, now);
}

/** Anexa `cnpjRisk` (ou null) a cada cliente da página, preservando os demais campos. */
export async function attachCustomerCnpjRisk<T extends CustomerIdentityForRisk>(
  prisma: CustomerCnpjRiskDb,
  customers: readonly T[],
  now: Date = new Date()
): Promise<Array<T & { cnpjRisk: CustomerCnpjRiskSummary | null }>> {
  const summaries = await loadCustomerCnpjRiskSummaries(prisma, customers, now);
  return customers.map((customer) => ({ ...customer, cnpjRisk: summaries.get(customer.id) ?? null }));
}
