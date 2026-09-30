/**
 * Carrega a população filtrada da tela Comercial > Clientes para exportação.
 * Mesmos filtros da grade (busca + responsável comercial), sem paginação de 20.
 */
import type { PrismaClient } from "@prisma/client";
import { attachCustomerCnpjRisk } from "./customerCnpjRiskSummary.server.js";
import {
  attachCustomerCommercialOwnerListFields,
  prepareCommercialOwnerCustomerListFilter,
} from "./crmCustomerCommercialOwner.js";
import { attachCustomerSalesBlocks } from "./commercial/customerSalesBlock.server.js";
import { buildCustomerListWhere, parseCustomerListQuery } from "./customerListQuery.js";
import {
  CUSTOMER_LIST_EXPORT_MAX,
  buildCustomerListReportAppliedFilters,
  buildCustomerListReportExportSummary,
  mapCustomerListReportExportRow,
  type CustomerListReportExportPayload,
} from "./customerListReportExport.js";

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
  options: { includeFinancialDetails: boolean }
): Promise<CustomerListReportExportPayload> {
  const list = parseCustomerListQuery(query);
  const ownerFilter = await prepareCommercialOwnerCustomerListFilter(list.commercialOwner);
  const where = buildCustomerListWhere(list.search, ownerFilter.ownerWhere);

  const totalMatched = await prisma.customer.count({ where });
  const items = await prisma.customer.findMany({
    where,
    orderBy: { companyName: "asc" },
    take: CUSTOMER_LIST_EXPORT_MAX,
    select: CUSTOMER_LIST_EXPORT_SELECT,
  });

  const withRisk = await attachCustomerCnpjRisk(prisma, items);
  const withOwners = await attachCustomerCommercialOwnerListFields(withRisk);
  const withBlocks = await attachCustomerSalesBlocks(prisma, withOwners, {
    includeFinancialDetails: options.includeFinancialDetails,
  });

  const rows = withBlocks.map((customer) =>
    mapCustomerListReportExportRow({
      companyName: customer.companyName,
      tradeName: customer.tradeName,
      taxId: customer.taxId,
      city: customer.city,
      state: customer.state,
      segment: customer.segment,
      status: customer.status,
      commercialOwnerName: customer.commercialOwnerName,
      cnpjRisk: customer.cnpjRisk,
      salesBlock: customer.salesBlock,
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: buildCustomerListReportAppliedFilters({
      search: list.search,
      ownerKey: list.commercialOwner,
      ownerOptions: ownerFilter.options,
    }),
    summary: buildCustomerListReportExportSummary(rows, totalMatched),
    rows,
  };
}
