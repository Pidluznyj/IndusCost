/**
 * Persistência / carga do PDF gerencial interno — Prisma apenas neste módulo.
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildProposalInternalManagementPdfBuffer,
  buildProposalInternalManagementPdfDocument,
  buildProposalInternalManagementPdfFilename,
  type ProposalInternalManagementPdfDocument,
} from "./proposalInternalManagementPdf.js";
import { resolveProposalCommercialListMargins } from "./proposalCommercialMarginRecalc.server.js";
import { applyProductionCostsToProposalDetail } from "./proposalMargin.server.js";

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

export type LoadProposalInternalManagementPdfResult =
  | {
      ok: true;
      document: ProposalInternalManagementPdfDocument;
      buffer: Buffer;
      filename: string;
    }
  | { ok: false; status: number; code: string; message: string };

export async function loadAndBuildProposalInternalManagementPdf(
  prisma: PrismaClient,
  proposalId: string
): Promise<LoadProposalInternalManagementPdfResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      Customer: true,
      items: {
        include: { Product: { select: { sku: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!proposal) {
    return {
      ok: false,
      status: 404,
      code: "PROPOSAL_NOT_FOUND",
      message: "Proposta não encontrada.",
    };
  }

  const enrichedProposal = await applyProductionCostsToProposalDetail(
    prisma,
    proposal
  );

  const commercialById = await resolveProposalCommercialListMargins(prisma, [
    proposal.id,
  ]);
  const commercial = commercialById.get(proposal.id);
  const totalMarginPerc =
    commercial?.totalMarginPerc != null
      ? commercial.totalMarginPerc
      : decimalToNumber(enrichedProposal.totalMarginPerc);
  const totalMarginValue =
    commercial?.totalMarginValue != null
      ? commercial.totalMarginValue
      : decimalToNumber(enrichedProposal.totalMarginValue);

  const document = buildProposalInternalManagementPdfDocument({
    id: enrichedProposal.id,
    number: enrichedProposal.number,
    title: enrichedProposal.title,
    status: enrichedProposal.status,
    responsible: enrichedProposal.responsible,
    companyIssuer: enrichedProposal.companyIssuer,
    validityDays: enrichedProposal.validityDays,
    paymentTerms: enrichedProposal.paymentTerms,
    paymentMethod: enrichedProposal.paymentMethod,
    freightCondition: enrichedProposal.freightCondition,
    deliveryLocation: enrichedProposal.deliveryLocation,
    notes: enrichedProposal.notes,
    internalNotes: enrichedProposal.internalNotes,
    createdAt: enrichedProposal.createdAt,
    customerName:
      enrichedProposal.Customer?.companyName ??
      enrichedProposal.Customer?.tradeName ??
      null,
    customerTradeName: enrichedProposal.Customer?.tradeName ?? null,
    customerDocument: enrichedProposal.Customer?.taxId ?? null,
    customerPhone: enrichedProposal.Customer?.phone ?? null,
    customerAddress: enrichedProposal.Customer?.address ?? null,
    customerCity: enrichedProposal.Customer?.city ?? null,
    customerState: enrichedProposal.Customer?.state ?? null,
    customerZip: enrichedProposal.Customer?.zipCode ?? null,
    totalGrossValue: decimalToNumber(enrichedProposal.totalGrossValue),
    totalDiscount: decimalToNumber(enrichedProposal.totalDiscount),
    totalNetValue: decimalToNumber(enrichedProposal.totalNetValue),
    totalCost:
      enrichedProposal.totalCost != null
        ? decimalToNumber(enrichedProposal.totalCost)
        : decimalToNumber(proposal.totalCost),
    totalMarginValue,
    totalMarginPerc,
    totalTaxes: decimalToNumber(enrichedProposal.totalTaxes),
    totalCommission: decimalToNumber(enrichedProposal.totalCommission),
    totalFreight: decimalToNumber(enrichedProposal.totalFreight),
    items: enrichedProposal.items.map((item) => {
      const breakdown = (
        item as {
          productionCostBreakdown?: {
            materialCost?: number | null;
            laborCost?: number | null;
            machineCost?: number | null;
            processCost?: number | null;
          } | null;
        }
      ).productionCostBreakdown;
      return {
        sku: item.Product?.sku ?? null,
        name: item.Product?.name ?? null,
        quantity: decimalToNumber(item.quantity),
        unit: item.unit,
        unitCost:
          item.unitCost != null ? decimalToNumber(item.unitCost) : null,
        negotiatedPrice: decimalToNumber(item.negotiatedPrice),
        suggestedPrice: decimalToNumber(item.suggestedPrice),
        discountPerc: decimalToNumber(item.discountPerc),
        discountValue: decimalToNumber(item.discountValue),
        marginValue: decimalToNumber(item.marginValue),
        marginPerc: decimalToNumber(item.marginPerc),
        commissionPerc: decimalToNumber(item.commissionPerc),
        commissionValue: decimalToNumber(item.commissionValue),
        taxesValue: decimalToNumber(item.taxesValue),
        freightValue: decimalToNumber(item.freightValue),
        notes: item.notes,
        pricingSnapshotJson: item.pricingSnapshotJson,
        commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
        priceTableId: item.priceTableId,
        priceTableVersionId: item.priceTableVersionId,
        priceSource: item.priceSource,
        productId: item.productId,
        productionCostBreakdown: breakdown ?? null,
      };
    }),
  });

  const buffer = buildProposalInternalManagementPdfBuffer(document);
  const filename = buildProposalInternalManagementPdfFilename({
    proposalNumber: enrichedProposal.number,
    customerName:
      enrichedProposal.Customer?.companyName ??
      enrichedProposal.Customer?.tradeName ??
      null,
  });

  return { ok: true, document, buffer, filename };
}
