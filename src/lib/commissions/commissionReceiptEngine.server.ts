import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptPreviewResult,
} from "./commissionReceiptEngine.js";
import { loadActiveCommissionRules } from "./commission-rule-engine.js";
import { parseCommissionVisualAuditQuery } from "./commissionQuery.js";
import {
  indexOrderBundlesByNfeId,
  mapReceivableSource,
} from "./commission-source-resolver.js";
import {
  loadCommissionOrderSourcesByNfeExternalIds,
  resolveCommissionPeriod,
} from "./commission-source-resolver.server.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import { decimalToNumber } from "./commission-money.js";
import {
  enrichVisualAuditRowsWithSellerIdentity,
  filterRowsByAppraisalMode,
} from "./commissionVisualAudit.js";
import { listCommissionVisualAuditPage } from "./commissionVisualAudit.server.js";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

export type LoadCommissionReceiptPreviewInput = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
};

export async function loadCommissionReceiptPreview(
  input: LoadCommissionReceiptPreviewInput
): Promise<CommissionReceiptPreviewResult> {
  const period = resolveCommissionPeriod({ year: input.year, month: input.month });

  const arPrismaRows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: period.from, lte: period.to },
      amountReceived: { gt: 0 },
      suspendCollection: { not: true },
      OR: [{ status: null }, { status: true }],
    },
    select: {
      externalId: true,
      personId: true,
      personName: true,
      sourceInvoiceId: true,
      sourceInvoiceNumber: true,
      dueDate: true,
      settlementDate: true,
      amountReceivable: true,
      amountReceived: true,
      balanceReceivable: true,
      description: true,
      suspendCollection: true,
      status: true,
    },
  });

  const receivables = arPrismaRows
    .map((row) => {
      const source = mapReceivableSource(row);
      if (!source.settlementDate || decimalToNumber(row.amountReceived) <= 0) return null;
      if (row.status === false || row.suspendCollection === true) return null;
      return {
        nomusReceivableId: source.nomusReceivableId,
        receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
        installmentNumber: source.installmentNumber,
        settlementDate: source.settlementDate,
        dueDate: source.dueDate,
        amountReceivable: source.amountReceivable,
        amountReceived: source.amountReceived,
        balanceReceivable: source.balanceReceivable,
        nomusNfeId: source.nomusNfeId,
        nfeNumber: row.sourceInvoiceNumber,
        customerExternalId: row.personId,
        customerId: null,
        customerName: row.personName,
        cancelled: row.status === false,
        suspended: row.suspendCollection === true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.nomusNfeId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const [orderBundles, identityCtx, rules, exclusionRules, auditPayload] = await Promise.all([
    loadCommissionOrderSourcesByNfeExternalIds(prisma, nfeIds),
    loadCommissionSellerIdentityContext(prisma),
    loadActiveCommissionRules(prisma),
    loadActiveCustomerExclusionRuleSnapshots(),
    listCommissionVisualAuditPage(
      parseCommissionVisualAuditQuery({
        year: input.year,
        month: input.month,
        appraisalMode: "payable",
        page: 1,
        pageSize: 500000,
        customer: input.customer,
        commissionPersonId: input.seller,
      }),
      GLOBAL_SCOPE
    ),
  ]);

  const ordersByNfeId = indexOrderBundlesByNfeId(orderBundles);
  const persistedAuditRows = enrichVisualAuditRowsWithSellerIdentity(
    filterRowsByAppraisalMode(auditPayload.rows, "PAYABLE", period),
    identityCtx
  );

  return buildCommissionReceiptPreview({
    year: input.year,
    month: input.month,
    seller: input.seller,
    customer: input.customer,
    includeExcluded: input.includeExcluded,
    includeExceptions: input.includeExceptions,
    receivables,
    ordersByNfeId,
    persistedAuditRows,
    rules,
    exclusionRules,
    identityCtx,
  });
}

/** Converte linha Prisma AR para input do motor (uso em testes integrados). */
export function mapNomusArRowToReceiptReceivableInput(row: {
  externalId: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  personId: number | null;
  personName: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: import("@prisma/client").Prisma.Decimal | null;
  amountReceived: import("@prisma/client").Prisma.Decimal | null;
  balanceReceivable: import("@prisma/client").Prisma.Decimal | null;
  description?: string | null;
  suspendCollection?: boolean | null;
  status?: boolean | null;
}) {
  const source = mapReceivableSource(row);
  if (!source.settlementDate) return null;
  return {
    nomusReceivableId: source.nomusReceivableId,
    receivableNumber: row.sourceInvoiceNumber ?? row.description ?? null,
    installmentNumber: source.installmentNumber,
    settlementDate: source.settlementDate,
    dueDate: source.dueDate,
    amountReceivable: source.amountReceivable,
    amountReceived: source.amountReceived,
    balanceReceivable: source.balanceReceivable,
    nomusNfeId: source.nomusNfeId,
    nfeNumber: row.sourceInvoiceNumber,
    customerExternalId: row.personId,
    customerId: null,
    customerName: row.personName,
    cancelled: row.status === false,
    suspended: row.suspendCollection === true,
  };
}

export function receivableReceivedTotal(rows: ReturnType<typeof mapNomusArRowToReceiptReceivableInput>[]): number {
  return rows.reduce((sum, row) => sum + (row ? decimalToNumber(row.amountReceived) : 0), 0);
}
