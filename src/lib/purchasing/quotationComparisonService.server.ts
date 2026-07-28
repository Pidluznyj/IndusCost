/**
 * Agrega comparação de fornecedores de uma cotação (OP-18).
 */
import type { PrismaClient } from "@prisma/client";
import { computeOfferRoundSavings } from "./negotiationRoundService.server.js";
import { countActiveEvidences } from "./purchaseEvidenceService.server.js";
import { PurchaseQuotationWorkflowError } from "./purchaseQuotationWorkflow.js";
import {
  buildComparisonSummaryCards,
  filterComparisonRows,
  markIncomparability,
  rankByNegotiatedCostInformative,
  type RoundTimelineEntry,
  type SupplierComparisonInput,
  type SupplierComparisonRow,
} from "./quotationComparisonEngine.js";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function buildQuotationComparison(
  prisma: PrismaClient,
  quotationId: string,
  filter?: {
    q?: string;
    status?: string;
    onlyComparable?: boolean;
    onlyWithEvidence?: boolean;
  }
) {
  const quotation = await prisma.purchaseQuotation.findUnique({
    where: { id: quotationId },
    include: {
      items: { orderBy: { lineNumber: "asc" } },
      suppliers: {
        include: {
          offers: {
            include: {
              items: true,
            },
          },
        },
        orderBy: { invitedAt: "asc" },
      },
      rounds: {
        include: { _count: { select: { lines: true } } },
        orderBy: { roundNumber: "asc" },
      },
    },
  });
  if (!quotation) {
    throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
  }

  const demandQty = quotation.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const inputs: SupplierComparisonInput[] = [];

  for (const supplier of quotation.suppliers) {
    const offer = supplier.offers[0];
    if (!offer) continue;

    let savings = null as Awaited<ReturnType<typeof computeOfferRoundSavings>> | null;
    try {
      savings = await computeOfferRoundSavings(prisma, quotationId, offer.id);
    } catch {
      savings = null;
    }

    const s = savings?.savings ?? null;
    const qtyOffered = offer.items.reduce((sum, it) => sum + (num(it.initialQuantity) ?? 0), 0);
    const initialUnitPrices = offer.items.map((it) => Number(it.initialUnitPrice));
    const initialUnitPriceAvg =
      initialUnitPrices.length > 0
        ? initialUnitPrices.reduce((a, b) => a + b, 0) / initialUnitPrices.length
        : null;

    let negotiatedUnitPriceAvg: number | null = null;
    if (s && s.totalQuantity > 0) {
      negotiatedUnitPriceAvg = s.itemsSubtotalNegotiated / s.totalQuantity;
    }

    const evidenceCount =
      (await countActiveEvidences(prisma, "OFFER", offer.id)) +
      (await countActiveEvidences(prisma, "QUOTATION_SUPPLIER", supplier.id));

    const hasNegotiatedRound = Boolean(savings?.roundId);

    let freightIncoterm: string | null = "FOB";
    let freightValue = num(offer.initialFreightValue);
    let leadTimeDays = offer.initialLeadTimeDays;
    let paymentTerms = offer.initialPaymentTerms;
    let minOrderQty = num(offer.initialMinOrderQty);
    let validityDate = offer.initialValidityDate
      ? offer.initialValidityDate.toISOString().slice(0, 10)
      : null;

    if (savings?.roundId) {
      const lines = await prisma.purchaseNegotiationRoundLine.findMany({
        where: { roundId: savings.roundId, offerItem: { offerId: offer.id } },
      });
      freightIncoterm = lines.find((l) => l.freightIncoterm)?.freightIncoterm || freightIncoterm;
      const lineFreight = lines.reduce((sum, l) => sum + (num(l.freightValue) ?? 0), 0);
      if (lineFreight > 0) freightValue = lineFreight;
      const lead = lines.map((l) => l.leadTimeDays).find((d) => d != null);
      if (lead != null) leadTimeDays = lead;
      const pay = lines.map((l) => l.paymentTerms).find((p) => p);
      if (pay) paymentTerms = pay;
      const moq = lines.map((l) => num(l.minOrderQty)).find((m) => m != null);
      if (moq != null) minOrderQty = moq;
    }

    inputs.push({
      offerId: offer.id,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierDisplayNameSnapshot,
      supplierDocument: supplier.supplierDocumentSnapshot,
      offerStatus: offer.status,
      currency: offer.currency || quotation.currency || "BRL",
      initialUnitPriceAvg,
      negotiatedUnitPriceAvg,
      initialComparableCost: s?.initialComparableCost ?? null,
      negotiatedComparableCost: s?.negotiatedComparableCost ?? null,
      totalGain: s?.totalGain ?? null,
      percentGain: s?.percentGain ?? null,
      freightValue,
      freightIncoterm,
      leadTimeDays,
      paymentTerms,
      minOrderQty,
      validityDate,
      quantityOffered: qtyOffered || null,
      quantityDemanded: demandQty || null,
      evidenceCount,
      hasNegotiatedRound,
      isWinner: offer.status === "VENCEDORA" || supplier.status === "VENCEDOR",
    });
  }

  const baseCurrency = (quotation.currency || "BRL").toUpperCase();
  const compared = markIncomparability(inputs, { preferredCurrency: baseCurrency });
  const filtered = filterComparisonRows(compared, filter ?? {});
  const cards = buildComparisonSummaryCards(
    compared.filter((r) => r.comparable),
    baseCurrency
  );

  const timeline: RoundTimelineEntry[] = quotation.rounds.map((r) => ({
    roundId: r.id,
    roundNumber: r.roundNumber,
    status: r.status,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    responsibleUserName: r.responsibleUserName,
    buyerReport: r.buyerReport,
    lineCount: r._count.lines,
  }));

  const winner = compared.find((r) => r.isWinner) ?? null;
  const informativeRank = rankByNegotiatedCostInformative(compared);

  return {
    quotation: {
      id: quotation.id,
      code: quotation.code,
      status: quotation.status,
      currency: quotation.currency,
      title: quotation.title,
      selectionNote:
        "A escolha do vencedor é humana e justificada — não use automaticamente o menor preço.",
    },
    cards,
    rows: filtered,
    allRows: compared,
    timeline,
    winner,
    informativeLowestCostOfferIds: informativeRank,
    filtersApplied: filter ?? {},
  };
}

export type QuotationComparisonResult = Awaited<ReturnType<typeof buildQuotationComparison>>;
export type { SupplierComparisonRow };
