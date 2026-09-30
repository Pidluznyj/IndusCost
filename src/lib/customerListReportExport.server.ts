/**
 * Carrega a população filtrada da tela Comercial > Clientes para exportação.
 * Mesmos filtros da grade (busca + responsável comercial), sem paginação de 20.
 */
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { attachCustomerCnpjRisk } from "./customerCnpjRiskSummary.server.js";
import {
  attachCustomerCommercialOwnerListFields,
  prepareCommercialOwnerCustomerListFilter,
} from "./crmCustomerCommercialOwner.js";
import { attachCustomerSalesBlocks } from "./commercial/customerSalesBlock.server.js";
import { attachCustomerLastPurchase } from "./commercial/customerLastPurchase.server.js";
import { buildCustomerListWhere, parseCustomerListQuery } from "./customerListQuery.js";
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
  }
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
  const withLastPurchase = await attachCustomerLastPurchase(prisma, withOwners);
  const withBlocks = await attachCustomerSalesBlocks(prisma, withLastPurchase, {
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
      lastPurchaseAt: customer.lastPurchaseAt,
      lastPurchaseStatus: customer.lastPurchaseStatus,
      cnpjRisk: customer.cnpjRisk,
      salesBlock: customer.salesBlock,
    })
  );

  const generatedAt = new Date().toISOString();
  const appliedFilters = buildCustomerListReportAppliedFilters({
    search: list.search,
    ownerKey: list.commercialOwner,
    ownerOptions: ownerFilter.options,
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
    summary: buildCustomerListReportExportSummary(rows, totalMatched),
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
