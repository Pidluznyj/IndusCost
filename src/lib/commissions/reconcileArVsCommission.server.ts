import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber } from "./commission-money.js";
import { listCommissionVisualAuditPage } from "./commissionVisualAudit.server.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { parseCommissionVisualAuditQuery } from "./commissionQuery.js";
import { mapPrismaRowToFinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import {
  buildArCommissionReconcile,
  type ArReceivableSnapshot,
} from "./reconcileArVsCommission.js";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

function toArSnapshot(row: ReturnType<typeof mapPrismaRowToFinanceArDashboardRow>): ArReceivableSnapshot {
  return {
    externalId: row.externalId,
    personName: row.personName,
    personId: row.personId,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    amountReceivable: row.amountReceivable,
    amountReceived: row.amountReceived,
    balanceReceivable: row.balanceReceivable,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
  };
}

export type ReconcileArVsCommissionQuery = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  nomusReference?: { base: number | null; commission: number | null };
};

export async function runArVsCommissionReconcile(query: ReconcileArVsCommissionQuery) {
  const periodFrom = new Date(query.year, query.month - 1, 1);
  const periodTo = new Date(query.year, query.month, 0, 23, 59, 59, 999);

  const [arPrismaRows, identityCtx, auditPayload] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      select: {
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
        paymentMethodName: true,
        bankAccountName: true,
        sourceInvoiceId: true,
        sourceInvoiceNumber: true,
        suspendCollection: true,
        status: true,
        syncedAt: true,
      },
    }),
    loadCommissionSellerIdentityContext(prisma),
    listCommissionVisualAuditPage(
      parseCommissionVisualAuditQuery({
        year: query.year,
        month: query.month,
        appraisalMode: "payable",
        page: 1,
        pageSize: 500000,
        customer: query.customer,
        commissionPersonId: query.seller,
      }),
      GLOBAL_SCOPE
    ),
  ]);

  const arRows = arPrismaRows.map((row) => toArSnapshot(mapPrismaRowToFinanceArDashboardRow(row)));
  const { cards, rows: payableRows } = auditPayload;

  return buildArCommissionReconcile({
    year: query.year,
    month: query.month,
    periodFrom,
    periodTo,
    arRows,
    payableRows,
    payableCards: {
      receivableAmountTotal: cards.receivableAmountTotal,
      receivedAmountTotal: cards.receivedAmountTotal,
      commissionableBaseTotal: cards.commissionableBaseTotal,
      commissionExpectedTotal: cards.commissionExpectedTotal,
      commissionReleasedTotal: cards.commissionReleasedTotal,
      commissionPendingTotal: cards.commissionPendingTotal,
      averageRatePercent: cards.averageRatePercent,
      receivableCount: cards.receivableCount,
    },
    identityCtx,
    referenceDate: periodTo,
    nomusReference: query.nomusReference,
  });
}
