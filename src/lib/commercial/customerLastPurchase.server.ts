/**
 * Anexa `lastPurchaseAt` / `lastPurchaseStatus` aos clientes de uma página
 * do grid (ou do export) em lote, pelo MESMO carregador da rotina de
 * inatividade (`loadLastValidInvoices`): quatro consultas por lote, nunca
 * uma por cliente.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { loadLastValidInvoices } from "./customerCommercialOwnerInactivity.server.js";
import { customerLastPurchaseFromInvoice, type CustomerLastPurchase } from "./customerLastPurchase.js";

export async function attachCustomerLastPurchase<T extends { id: string }>(
  client: PrismaClient | Prisma.TransactionClient,
  customers: T[]
): Promise<Array<T & CustomerLastPurchase>> {
  if (customers.length === 0) return [];
  const invoices = await loadLastValidInvoices(client, customers.map((customer) => customer.id));
  return customers.map((customer) => ({ ...customer, ...customerLastPurchaseFromInvoice(invoices.get(customer.id)) }));
}
