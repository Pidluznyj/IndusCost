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

  const document = buildProposalInternalManagementPdfDocument({
    id: proposal.id,
    number: proposal.number,
    title: proposal.title,
    status: proposal.status,
    responsible: proposal.responsible,
    companyIssuer: proposal.companyIssuer,
    validityDays: proposal.validityDays,
    paymentTerms: proposal.paymentTerms,
    paymentMethod: proposal.paymentMethod,
    freightCondition: proposal.freightCondition,
    deliveryLocation: proposal.deliveryLocation,
    notes: proposal.notes,
    internalNotes: proposal.internalNotes,
    createdAt: proposal.createdAt,
    customerName: proposal.Customer?.companyName ?? proposal.Customer?.tradeName ?? null,
    customerDocument: proposal.Customer?.taxId ?? null,
    totalGrossValue: decimalToNumber(proposal.totalGrossValue),
    totalDiscount: decimalToNumber(proposal.totalDiscount),
    totalNetValue: decimalToNumber(proposal.totalNetValue),
    totalCost: decimalToNumber(proposal.totalCost),
    totalMarginValue: decimalToNumber(proposal.totalMarginValue),
    totalMarginPerc: decimalToNumber(proposal.totalMarginPerc),
    totalTaxes: decimalToNumber(proposal.totalTaxes),
    totalCommission: decimalToNumber(proposal.totalCommission),
    totalFreight: decimalToNumber(proposal.totalFreight),
    items: proposal.items.map((item) => ({
      sku: item.Product?.sku ?? null,
      name: item.Product?.name ?? null,
      quantity: decimalToNumber(item.quantity),
      unit: item.unit,
      unitCost: decimalToNumber(item.unitCost),
      negotiatedPrice: decimalToNumber(item.negotiatedPrice),
      suggestedPrice: decimalToNumber(item.suggestedPrice),
      marginValue: decimalToNumber(item.marginValue),
      marginPerc: decimalToNumber(item.marginPerc),
      commissionPerc: decimalToNumber(item.commissionPerc),
      commissionValue: decimalToNumber(item.commissionValue),
      taxesValue: decimalToNumber(item.taxesValue),
      freightValue: decimalToNumber(item.freightValue),
      notes: item.notes,
    })),
  });

  const buffer = buildProposalInternalManagementPdfBuffer(document);
  const filename = buildProposalInternalManagementPdfFilename({
    proposalNumber: proposal.number,
    customerName: proposal.Customer?.companyName ?? proposal.Customer?.tradeName ?? null,
  });

  return { ok: true, document, buffer, filename };
}
