/**
 * Prévia browser-safe da margem comercial da Proposta.
 * Usa o motor puro — não duplica fórmula; backend continua autoritativo no save.
 */
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import {
  calculateProposalItemCommercialMargin,
  summarizeProposalCommercialMargins,
  unavailableProposalCommercialMarginItem,
  type ProposalCommercialMarginItemPayload,
  type ProposalCommercialMarginSummaryPayload,
} from "./proposalCommercialMargin.js";
import {
  buildProposalCommercialMarginFreeze,
  recalculateProposalCommercialMarginFromFrozenFormation,
  resolveProposalItemCommercialPricingSnapshot,
  toProposalCommercialPricingSnapshot,
  type ProposalCommercialMarginFreeze,
  type ProposalCommercialPricingSnapshot,
} from "./proposalCommercialMarginSnapshot.js";

export type ProposalItemCommercialPreviewInput = {
  productId?: string | null;
  quantity: number;
  suggestedPrice?: number | null;
  negotiatedPrice: number;
  discountPerc?: number | null;
  discountValue?: number | null;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  priceSource?: string | null;
  commercialPricingSnapshotJson?: unknown;
  pricingSnapshotJson?: unknown;
  /** Formação em sessão (após fetch de faixas) — não vem do Pedido. */
  commercialFormation?: {
    formationContextId: string;
    referenceDate: string;
    priceTableId?: string | null;
    priceTableVersionId?: string | null;
    frozenCostUnit: number;
    taxRate: number;
    freightRate: number;
    freightAbsoluteUnit: number;
    otherVariablesRate: number;
    tiers: CommercialMarginTier[];
  } | null;
};

function snapshotToFreeze(
  snapshot: ProposalCommercialPricingSnapshot,
  quantity: number
): ProposalCommercialMarginFreeze {
  return {
    schemaVersion: 1,
    formationContextId: snapshot.formationContextId,
    priceTableId: snapshot.priceTableId,
    priceTableVersionId: snapshot.priceTableVersionId,
    referenceDate: snapshot.referenceDate,
    productId: null,
    quantity,
    referenceTableUnitPrice: snapshot.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: snapshot.negotiatedGrossUnitPrice,
    informedDiscountRate: snapshot.informedDiscountRate,
    informedDiscountValue: snapshot.informedDiscountValue,
    finalNetUnitPrice: snapshot.finalNetUnitPrice,
    finalNetLineValue: snapshot.finalNetLineValue,
    frozenCostUnit: snapshot.frozenCostUnit,
    taxRate: snapshot.taxRate,
    freightRate: snapshot.freightRate,
    freightAbsoluteUnit: snapshot.freightAbsoluteUnit,
    otherVariablesRate: snapshot.otherVariablesRate,
    tiers: snapshot.tiers,
    calculatedCommissionRate: snapshot.calculatedCommissionRate,
    commercialMarginRate: snapshot.commercialMarginRate,
    commercialMarginValue: snapshot.commercialMarginValue,
    warnings: snapshot.warnings,
    calculationSource: snapshot.calculationSource,
    reasonCode: null,
    capturedAt: new Date(0).toISOString(),
  };
}

/**
 * Calcula prévia de um item: prioriza formação congelada; senão formação em sessão.
 */
export function previewProposalItemCommercialMargin(
  item: ProposalItemCommercialPreviewInput
): {
  marginItem: ProposalCommercialMarginItemPayload;
  snapshot: ProposalCommercialPricingSnapshot | null;
} {
  const qty = Number(item.quantity) || 0;
  const negotiated = Number(item.negotiatedPrice);
  const discountPerc =
    item.discountPerc != null && Number.isFinite(Number(item.discountPerc))
      ? Number(item.discountPerc) / 100
      : null;
  const discountValue =
    item.discountValue != null && Number.isFinite(Number(item.discountValue))
      ? Number(item.discountValue)
      : null;

  const stored = resolveProposalItemCommercialPricingSnapshot({
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    pricingSnapshotJson: item.pricingSnapshotJson,
  });

  if (stored && stored.tiers.length >= 2 && stored.frozenCostUnit != null) {
    const { marginItem, freeze } = recalculateProposalCommercialMarginFromFrozenFormation({
      freeze: snapshotToFreeze(stored, qty > 0 ? qty : stored.tiers.length ? 1 : 0),
      quantity: qty,
      negotiatedGrossUnitPrice: negotiated,
      informedDiscountRate: discountPerc,
      informedDiscountValue: discountValue,
      referenceTableUnitPrice:
        item.suggestedPrice ?? stored.referenceTableUnitPrice,
    });
    return {
      marginItem,
      snapshot: toProposalCommercialPricingSnapshot(freeze),
    };
  }

  const formation = item.commercialFormation;
  if (!formation || formation.tiers.length < 2) {
    const reason =
      !item.priceTableId && item.priceSource !== "PRICE_TABLE"
        ? "PRICE_TABLE_NOT_SELECTED"
        : "INCOMPLETE_MARGIN_TIERS";
    const marginItem = unavailableProposalCommercialMarginItem({
      quantity: qty,
      referenceTableUnitPrice: item.suggestedPrice ?? null,
      negotiatedGrossUnitPrice: negotiated,
      reasonCode: reason,
    });
    return { marginItem, snapshot: null };
  }

  const marginItem = calculateProposalItemCommercialMargin({
    quantity: qty,
    referenceTableUnitPrice: item.suggestedPrice ?? null,
    negotiatedGrossUnitPrice: negotiated,
    informedDiscountRate: discountPerc,
    informedDiscountValue: discountValue,
    frozenCostUnit: formation.frozenCostUnit,
    taxRate: formation.taxRate,
    freightRate: formation.freightRate,
    freightAbsoluteUnit: formation.freightAbsoluteUnit,
    otherVariablesRate: formation.otherVariablesRate,
    tiers: formation.tiers,
    formationContextId: formation.formationContextId,
    referenceDate: formation.referenceDate,
  });

  const freeze = buildProposalCommercialMarginFreeze({
    formationContextId: formation.formationContextId,
    priceTableId: formation.priceTableId ?? item.priceTableId ?? null,
    priceTableVersionId: formation.priceTableVersionId ?? item.priceTableVersionId ?? null,
    referenceDate: formation.referenceDate,
    productId: item.productId ?? null,
    marginItem,
    frozenCostUnit: { presence: "value", value: formation.frozenCostUnit },
    taxRate: { presence: "value", value: formation.taxRate },
    freightRate: { presence: "value", value: formation.freightRate },
    freightAbsoluteUnit: { presence: "value", value: formation.freightAbsoluteUnit },
    otherVariablesRate: { presence: "value", value: formation.otherVariablesRate },
    informedDiscountRate:
      discountPerc == null ? { presence: "null" } : { presence: "value", value: discountPerc },
    informedDiscountValue:
      discountValue == null ? { presence: "null" } : { presence: "value", value: discountValue },
    tiers: formation.tiers,
  });

  return {
    marginItem,
    snapshot: toProposalCommercialPricingSnapshot(freeze),
  };
}

export function previewProposalCommercialMargins(
  items: ReadonlyArray<ProposalItemCommercialPreviewInput>
): {
  byIndex: ProposalCommercialMarginItemPayload[];
  snapshots: Array<ProposalCommercialPricingSnapshot | null>;
  summary: ProposalCommercialMarginSummaryPayload;
} {
  const byIndex: ProposalCommercialMarginItemPayload[] = [];
  const snapshots: Array<ProposalCommercialPricingSnapshot | null> = [];
  for (const item of items) {
    const preview = previewProposalItemCommercialMargin(item);
    byIndex.push(preview.marginItem);
    snapshots.push(preview.snapshot);
  }
  return {
    byIndex,
    snapshots,
    summary: summarizeProposalCommercialMargins(byIndex),
  };
}
