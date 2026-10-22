/**
 * Página da carteira recortada pela decisão oficial.
 * A situação não é coluna: a leitura acontece no recorte já filtrado por busca, estado, cidade e responsável.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { attachCustomerCnpjRisk } from "../customerCnpjRiskSummary.server.js";
import { attachCustomerLastPurchase } from "./customerLastPurchase.server.js";
import { attachCustomerSalesBlocks } from "./customerSalesBlock.server.js";
import {
  attachCustomerCommercialOwnerListFields,
} from "../crmCustomerCommercialOwner.js";
import { CUSTOMER_LIST_EXPORT_MAX } from "../customerListReportExport.js";
import { loadPortfolioCredit } from "./portfolioCredit.server.js";
import { portfolioCreditReadFailed } from "./portfolioCredit.js";
import {
  portfolioDecisionMatchesCreditFilter,
  type CustomerCreditListFilter,
} from "./customerCreditListFilter.js";

export async function loadCustomerCreditFilteredPage(
  prisma: PrismaClient,
  input: {
    where: Prisma.CustomerWhereInput;
    skip: number;
    limit: number;
    creditStatus: CustomerCreditListFilter;
    includeFinancialDetails: boolean;
    evaluatedAt?: Date;
  }
): Promise<{ items: Array<Record<string, unknown> & { id: string }>; total: number; capped: boolean }> {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const totalInScope = await prisma.customer.count({ where: input.where });
  const capped = totalInScope > CUSTOMER_LIST_EXPORT_MAX;
  const heads = await prisma.customer.findMany({
    where: input.where,
    orderBy: { companyName: "asc" },
    take: CUSTOMER_LIST_EXPORT_MAX,
    select: { id: true, taxId: true, nomusExternalPersonId: true },
  });
  const withRisk = await attachCustomerCnpjRisk(prisma, heads, evaluatedAt);
  const credit = await loadPortfolioCredit(prisma, withRisk, evaluatedAt);
  const matchedIds = heads
    .filter((customer) =>
      portfolioDecisionMatchesCreditFilter(credit.get(customer.id)?.decision.customerStatus, input.creditStatus)
    )
    .map((customer) => customer.id);
  const pageIds = matchedIds.slice(input.skip, input.skip + input.limit);
  const rows = pageIds.length
    ? await prisma.customer.findMany({ where: { id: { in: pageIds } } })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  const withPageRisk = await attachCustomerCnpjRisk(prisma, ordered, evaluatedAt);
  const withOwners = await attachCustomerCommercialOwnerListFields(withPageRisk);
  const withLastPurchase = await attachCustomerLastPurchase(prisma, withOwners);
  const withBlocks = await attachCustomerSalesBlocks(prisma, withLastPurchase, {
    includeFinancialDetails: input.includeFinancialDetails,
    now: evaluatedAt,
  });
  return {
    total: matchedIds.length,
    capped,
    items: withBlocks.map((customer) => ({
      ...customer,
      portfolioCredit: credit.get(customer.id) ?? portfolioCreditReadFailed(evaluatedAt),
    })),
  };
}
