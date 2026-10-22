/**
 * Carrega a população filtrada da tela Comercial > Clientes para exportação.
 * Mesmos filtros da grade (busca, responsável, estado, cidade e situação de crédito), sem paginação de 20.
 */
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { attachCustomerCnpjRisk } from "./customerCnpjRiskSummary.server.js";
import { portfolioDecisionMatchesCreditFilter } from "./commercial/customerCreditListFilter.js";
import { attachPortfolioCredit } from "./commercial/portfolioCredit.server.js";
import {
  attachCustomerCommercialOwnerListFields,
  prepareCommercialOwnerCustomerListFilter,
} from "./crmCustomerCommercialOwner.js";
import { attachCustomerSalesBlocks } from "./commercial/customerSalesBlock.server.js";
import { attachCustomerLastPurchase } from "./commercial/customerLastPurchase.server.js";
import {
  buildCustomerListWhere,
  buildCustomerStateWhere,
  parseCustomerListQuery,
  resolveCustomerCityFilter,
} from "./customerListQuery.js";
import {
  CUSTOMER_LIST_EXPORT_MAX,
  buildCustomerListReportAppliedFilters,
  buildCustomerListReportExportSummary,
  mapCustomerListReportExportRow,
  type CustomerListReportExportPayload,
} from "./customerListReportExport.js";
import {
  CUSTOMER_LIST_REPORT_CLASSIFICATION,
  buildCustomerListReportCopyCode,
  serializeCustomerListReportFingerprintSource,
} from "./customerListReportPrintMeta.js";

const CUSTOMER_LIST_EXPORT_SELECT = {
  id: true,
  companyName: true,
  tradeName: true,
  taxId: true,
  city: true,
  state: true,
  segment: true,
  status: true,
  nomusExternalPersonId: true,
} as const;

export async function loadCustomerListReportExportPayload(
  prisma: PrismaClient,
  query: Record<string, unknown>,
  options: {
    includeFinancialDetails: boolean;
    emitterName?: string | null;
    emitterEmail?: string | null;
    emitterUserId?: string | null;
    evaluatedAt?: Date;
  }
): Promise<CustomerListReportExportPayload> {
  const list = parseCustomerListQuery(query);
  const ownerFilter = await prepareCommercialOwnerCustomerListFilter(list.commercialOwner);
  const stateWhere = buildCustomerStateWhere(list.state);
  const cityRows = await prisma.customer.findMany({
    where: stateWhere,
    select: { city: true, state: true },
    distinct: ["city", "state"],
  });
  const cityFilter = resolveCustomerCityFilter(cityRows, list.state, list.city);
  const where = buildCustomerListWhere(
    list.search,
    ownerFilter.ownerWhere,
    stateWhere,
    cityFilter.cityWhere
  );

  const totalMatched = await prisma.customer.count({ where });
  const items = await prisma.customer.findMany({
    where,
    orderBy: { companyName: "asc" },
    take: CUSTOMER_LIST_EXPORT_MAX,
    select: CUSTOMER_LIST_EXPORT_SELECT,
  });

  const evaluatedAt = options.evaluatedAt ?? new Date();
  const withRisk = await attachCustomerCnpjRisk(prisma, items, evaluatedAt);
  const withOwners = await attachCustomerCommercialOwnerListFields(withRisk);
  const withLastPurchase = await attachCustomerLastPurchase(prisma, withOwners);
  const withBlocks = await attachCustomerSalesBlocks(prisma, withLastPurchase, {
    includeFinancialDetails: options.includeFinancialDetails,
    now: evaluatedAt,
  });
  const withCredit = await attachPortfolioCredit(prisma, withBlocks, evaluatedAt);
  const creditCapped = Boolean(list.creditStatus) && totalMatched > CUSTOMER_LIST_EXPORT_MAX;
  const creditMatched = list.creditStatus
    ? withCredit.filter((customer) =>
        portfolioDecisionMatchesCreditFilter(customer.portfolioCredit?.decision.customerStatus, list.creditStatus)
      )
    : withCredit;

  const rows = creditMatched.map((customer) =>
    mapCustomerListReportExportRow({
      companyName: customer.companyName,
      tradeName: customer.tradeName,
      taxId: customer.taxId,
      city: customer.city,
      state: customer.state,
      segment: customer.segment,
      status: customer.status,
      commercialOwnerName: customer.commercialOwnerName,
      lastPurchaseAt: customer.lastPurchaseAt,
      lastPurchaseStatus: customer.lastPurchaseStatus,
      cnpjRisk: customer.cnpjRisk,
      salesBlock: customer.salesBlock,
      portfolioCredit: customer.portfolioCredit,
    })
  );

  const generatedAt = new Date().toISOString();
  const appliedFilters = buildCustomerListReportAppliedFilters({
    search: list.search,
    ownerKey: list.commercialOwner,
    ownerOptions: ownerFilter.options,
    stateUf: list.state,
    cityKey: list.city,
    cityLabel: cityFilter.options.find((option) => option.key === list.city)?.label,
    creditStatus: list.creditStatus,
    creditStatusCapped: creditCapped,
  });
  const emitterName = options.emitterName?.trim() || "—";
  const emitterEmail = options.emitterEmail?.trim() || "—";
  const emitterUserId = options.emitterUserId?.trim() || "unknown";
  const fingerprint = createHash("sha256")
    .update(
      serializeCustomerListReportFingerprintSource({
        generatedAt,
        emitterUserId,
        emitterEmail,
        filters: appliedFilters,
        rowCount: rows.length,
        firstTaxId: rows[0]?.taxId ?? "",
        lastTaxId: rows[rows.length - 1]?.taxId ?? "",
      }),
      "utf8"
    )
    .digest("hex");

  return {
    generatedAt,
    appliedFilters,
    summary: buildCustomerListReportExportSummary(rows, list.creditStatus ? rows.length : totalMatched),
    rows,
    copyControl: {
      copyCode: buildCustomerListReportCopyCode(new Date(generatedAt), fingerprint),
      fingerprint,
      classification: CUSTOMER_LIST_REPORT_CLASSIFICATION,
      emitterName,
      emitterEmail,
      emitterUserId,
    },
  };
}
