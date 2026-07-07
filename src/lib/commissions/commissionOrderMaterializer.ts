/**
 * Materialização idempotente de snapshots de comissão na venda (pedido/NF).
 * Lógica pura — persistência em commissionOrderMaterializer.server.ts.
 */
import type { CommissionOrderItemCalculationResult } from "./commissionOrderCalculation.js";
import {
  aggregateOrderSnapshotTotals,
  buildCommissionOrderItemSnapshotSourceHash,
  buildCommissionOrderSnapshotSourceHash,
  mapCalculationResultToItemHashInput,
  toCommissionOrderItemSnapshotStatus,
  type CommissionOrderItemSnapshotStatusValue,
} from "./commissionOrderSnapshot.js";
import {
  resolveCommissionRuleReferenceDate,
  type CommissionOrderSourceBundle,
} from "./commission-source-resolver.js";
import type { CommissionSellerIdentityResolution } from "./commissionSellerIdentity.js";
import type { CommissionRuleSnapshot } from "./commissionReceiptLedger.js";

export type CommissionOrderMaterializationAction = "unchanged" | "created" | "superseded";

export type CommissionOrderItemSnapshotDraft = {
  salesOrderItemId: string;
  productId: string;
  productNameSnapshot: string;
  soldAmount: number;
  marginPercent: number | null;
  commissionRatePercent: number;
  grossCommissionAmount: number;
  finalCommissionAmount: number;
  ruleId: string | null;
  ruleSnapshotJson: CommissionRuleSnapshot | null;
  exclusionReason: string | null;
  sourceHash: string;
  status: CommissionOrderItemSnapshotStatusValue;
};

export type CommissionOrderSnapshotDraft = {
  salesOrderId: string;
  nfeId: number | null;
  customerId: string;
  customerNameSnapshot: string;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  saleDate: Date;
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
  sourceHash: string;
  items: CommissionOrderItemSnapshotDraft[];
};

export type CommissionOrderMaterializationPreview = {
  salesOrderId: string;
  nfeId: number | null;
  sourceHash: string;
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
  items: Array<{
    salesOrderItemId: string;
    productNameSnapshot: string;
    status: CommissionOrderItemSnapshotStatusValue;
    grossCommissionAmount: number;
    finalCommissionAmount: number;
    exclusionReason: string | null;
  }>;
};

export type CommissionOrderMaterializationResult = {
  action: CommissionOrderMaterializationAction;
  snapshotId: string | null;
  previousSnapshotId: string | null;
  sourceHash: string;
  dryRun: boolean;
  preview: CommissionOrderMaterializationPreview;
};

export function resolveMaterializationAction(
  existingActive: { id: string; sourceHash: string } | null,
  newSourceHash: string
): CommissionOrderMaterializationAction {
  if (!existingActive) return "created";
  if (existingActive.sourceHash === newSourceHash) return "unchanged";
  return "superseded";
}

export function buildCommissionOrderMaterializationPreview(
  draft: CommissionOrderSnapshotDraft
): CommissionOrderMaterializationPreview {
  return {
    salesOrderId: draft.salesOrderId,
    nfeId: draft.nfeId,
    sourceHash: draft.sourceHash,
    totalSoldAmount: draft.totalSoldAmount,
    totalGrossCommissionAmount: draft.totalGrossCommissionAmount,
    totalFinalCommissionAmount: draft.totalFinalCommissionAmount,
    items: draft.items.map((item) => ({
      salesOrderItemId: item.salesOrderItemId,
      productNameSnapshot: item.productNameSnapshot,
      status: item.status,
      grossCommissionAmount: item.grossCommissionAmount,
      finalCommissionAmount: item.finalCommissionAmount,
      exclusionReason: item.exclusionReason,
    })),
  };
}

function pickPrimaryNfeId(
  order: CommissionOrderSourceBundle,
  preferredNfeId?: number | null
): number | null {
  if (preferredNfeId != null) {
    const linked = order.linkedNfes.some((nfe) => nfe.nfeExternalId === preferredNfeId);
    if (linked) return preferredNfeId;
  }
  return order.authorizedOutputNfes[0]?.nfeExternalId ?? null;
}

/** NF usada no snapshot/schedule — respeita override quando vinculada ao pedido. */
export function resolveMaterializationNfeId(
  order: CommissionOrderSourceBundle,
  preferredNfeId?: number | null
): number | null {
  return pickPrimaryNfeId(order, preferredNfeId);
}

/** Monta o rascunho do snapshot (cabeçalho + itens + sourceHash) a partir do cálculo puro. */
export function buildCommissionOrderSnapshotDraft(input: {
  order: CommissionOrderSourceBundle;
  customerId: string;
  customerNameSnapshot: string;
  lines: CommissionOrderItemCalculationResult[];
  sellerResolution: CommissionSellerIdentityResolution;
  nfeId?: number | null;
}): CommissionOrderSnapshotDraft {
  const nfeId = pickPrimaryNfeId(input.order, input.nfeId);
  const saleDate = resolveCommissionRuleReferenceDate(input.order, nfeId);
  const itemNamesById = new Map(
    input.order.items.map((item) => [item.localItemId, item.productName])
  );
  const hashItems = input.lines.map(mapCalculationResultToItemHashInput);
  const totals = aggregateOrderSnapshotTotals(hashItems);
  const sourceHash = buildCommissionOrderSnapshotSourceHash({
    salesOrderId: input.order.localOrderId,
    nfeId,
    saleDate: saleDate.toISOString(),
    rawSellerId: input.order.seller.nomusSellerId,
    canonicalSellerId: input.sellerResolution.canonicalSellerId,
    items: hashItems,
  });

  const items: CommissionOrderItemSnapshotDraft[] = input.lines.map((line) => {
    const status = toCommissionOrderItemSnapshotStatus(line.status);
    return {
      salesOrderItemId: line.itemId,
      productId: line.productId,
      productNameSnapshot: itemNamesById.get(line.itemId) ?? line.productId,
      soldAmount: line.soldAmount,
      marginPercent: line.marginPercent,
      commissionRatePercent: line.commissionRatePercent,
      grossCommissionAmount: line.grossCommissionAmount,
      finalCommissionAmount: line.netCommissionAmount,
      ruleId: line.ruleId,
      ruleSnapshotJson: line.ruleSnapshot,
      exclusionReason: line.exclusionReason,
      status,
      sourceHash: buildCommissionOrderItemSnapshotSourceHash({
        salesOrderId: input.order.localOrderId,
        nfeId,
        salesOrderItemId: line.itemId,
        productId: line.productId,
        soldAmount: line.soldAmount,
        marginPercent: line.marginPercent,
        commissionRatePercent: line.commissionRatePercent,
        grossCommissionAmount: line.grossCommissionAmount,
        finalCommissionAmount: line.netCommissionAmount,
        ruleId: line.ruleId,
        status,
      }),
    };
  });

  return {
    salesOrderId: input.order.localOrderId,
    nfeId,
    customerId: input.customerId,
    customerNameSnapshot: input.customerNameSnapshot,
    rawSellerId: input.order.seller.nomusSellerId,
    rawSellerName: input.order.seller.responsibleName,
    canonicalSellerId: input.sellerResolution.canonicalSellerId,
    canonicalSellerName: input.sellerResolution.canonicalSellerName,
    sellerResolutionStatus: input.sellerResolution.resolutionStatus,
    saleDate,
    ...totals,
    sourceHash,
    items,
  };
}
