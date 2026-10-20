/**
 * Carga da análise de inadimplência comercial.
 *
 * Somente leitura de Customer, SalesOrder (evidência de identidade) e do
 * stage NomusAccountsReceivable. Não grava título, não altera a trava de
 * venda e não muda as consultas do dashboard financeiro.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import {
  analyzeCommercialDelinquency,
  commercialDelinquencyMoney,
  type CommercialDelinquencyAnalysis,
  type CommercialDelinquencySyncRunStatus,
  type CommercialDelinquencyTitleInput,
} from "./customerDelinquencyAnalysis.js";

export type CustomerDelinquencyDb = Pick<
  PrismaClient,
  "customer" | "salesOrder" | "nomusAccountsReceivable" | "nomusSourceSyncRun"
>;

const CUSTOMER_SELECT = {
  id: true,
  taxId: true,
  nomusExternalPersonId: true,
} as const;

const AR_SELECT = {
  externalId: true,
  personId: true,
  personName: true,
  personCnpj: true,
  companyName: true,
  description: true,
  comments: true,
  dueDate: true,
  settlementDate: true,
  amountReceivable: true,
  amountReceived: true,
  balanceReceivable: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  paymentMethodName: true,
  bankAccountName: true,
  suspendCollection: true,
  status: true,
  syncedAt: true,
  sourcePresenceStatus: true,
  rawPayload: true,
} as const;

type ArRow = Prisma.NomusAccountsReceivableGetPayload<{ select: typeof AR_SELECT }>;

function toTitle(row: ArRow): CommercialDelinquencyTitleInput {
  return {
    externalId: row.externalId,
    personId: row.personId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    companyName: row.companyName,
    description: row.description,
    comments: row.comments,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    amountReceivable: commercialDelinquencyMoney(row.amountReceivable),
    amountReceived: commercialDelinquencyMoney(row.amountReceived),
    balanceReceivable: commercialDelinquencyMoney(row.balanceReceivable),
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    suspendCollection: row.suspendCollection,
    nomusStatus: row.status,
    syncedAt: row.syncedAt,
    sourcePresenceStatus: row.sourcePresenceStatus,
    rawPayload: row.rawPayload,
  };
}

function asRunStatus(status: string | null | undefined): CommercialDelinquencySyncRunStatus | null {
  if (
    status === "SUCCESS" ||
    status === "FAILED" ||
    status === "INCONCLUSIVE" ||
    status === "RUNNING"
  ) {
    return status;
  }
  return null;
}

/**
 * Um cliente. Identidade em lote (cadastro, pares de CNPJ, pedidos). O stage
 * financeiro só é lido depois que o CNPJ não é ambíguo.
 */
export async function analyzeCustomerDelinquency(
  db: CustomerDelinquencyDb,
  customerId: string,
  referenceDate: Date = new Date()
): Promise<CommercialDelinquencyAnalysis> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: CUSTOMER_SELECT,
  });
  if (!customer) {
    return analyzeCommercialDelinquency({
      customerId,
      taxId: null,
      nomusExternalPersonId: null,
      salesOrderExternalCustomerIds: [],
      peerCustomerIdsWithSameCnpj: [],
      titles: [],
      syncCutoff: null,
      latestRunStatus: null,
      payloadComplete: null,
      referenceDate,
    });
  }

  const cnpj = normalizeCnpj(customer.taxId);
  const taxIdKeys = [...new Set([cnpj, formatCnpj(cnpj)].filter((value) => value && value !== "—"))];
  const [peers, orders] = await Promise.all([
    taxIdKeys.length === 0
      ? Promise.resolve([])
      : db.customer.findMany({
          where: { taxId: { in: taxIdKeys } },
          select: { id: true },
        }),
    db.salesOrder.findMany({
      where: { customerId },
      select: { externalCustomerId: true },
    }),
  ]);
  const peerIds = peers.map((peer) => peer.id);
  const salesOrderExternalCustomerIds = orders.map((order) => order.externalCustomerId);

  // CNPJ ambíguo: não lê o stage financeiro de nenhum dos cadastros.
  if (peerIds.some((id) => id !== customer.id)) {
    return analyzeCommercialDelinquency({
      customerId: customer.id,
      taxId: customer.taxId,
      nomusExternalPersonId: customer.nomusExternalPersonId,
      salesOrderExternalCustomerIds,
      peerCustomerIdsWithSameCnpj: peerIds,
      titles: [],
      syncCutoff: null,
      latestRunStatus: null,
      payloadComplete: null,
      referenceDate,
    });
  }

  const personId = customer.nomusExternalPersonId;
  const titleQuery: Promise<ArRow[]> =
    personId != null && personId > 0
      ? db.nomusAccountsReceivable.findMany({
          where: { personId },
          select: AR_SELECT,
        })
      : Promise.resolve([]);
  const [syncAgg, latestRun, titleRows] = await Promise.all([
    db.nomusAccountsReceivable.aggregate({ _max: { syncedAt: true } }),
    db.nomusSourceSyncRun.findFirst({
      where: { entityType: "ACCOUNTS_RECEIVABLE" },
      orderBy: { startedAt: "desc" },
      select: { status: true, payloadComplete: true },
    }),
    titleQuery,
  ]);

  const syncCutoff = buildNomusArReportSyncCutoff(syncAgg._max.syncedAt);
  const titles = titleRows.map(toTitle);

  return analyzeCommercialDelinquency({
    customerId: customer.id,
    taxId: customer.taxId,
    nomusExternalPersonId: customer.nomusExternalPersonId,
    salesOrderExternalCustomerIds,
    peerCustomerIdsWithSameCnpj: peerIds,
    titles,
    syncCutoff,
    latestRunStatus: asRunStatus(latestRun?.status),
    payloadComplete: latestRun?.payloadComplete ?? null,
    referenceDate,
  });
}
