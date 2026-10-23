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
import { createHash } from "node:crypto";
import {
  allocateItemAmountByQuantity,
  type InvoiceAllocationBasis,
  type InvoiceAllocationEvidence,
  type OrderInvoiceAllocationForNfe,
} from "./commissionInvoiceAllocation.js";

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
  /** B5 — só em snapshot alocado/retido (base histórica fica sem). */
  orderedQuantity?: number | null;
  invoicedQuantity?: number | null;
  cumulativeInvoicedQuantity?: number | null;
  itemFullSoldAmount?: number | null;
  itemFullCommissionAmount?: number | null;
  allocationEvidence?: InvoiceAllocationEvidence[] | null;
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
  /** Como o snapshot mede a venda (B5). */
  allocationBasis: InvoiceAllocationBasis;
  allocationReason?: string | null;
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
  /**
   * Alocação por item desta NF-e (B5). Ausente/FULL_ORDER_LEGACY = pedido inteiro
   * (mesmo snapshot e mesmo hash de antes). INVOICED_ALLOCATION = só a parcela
   * faturada; ALLOCATION_PENDING = comissão retida (itens ERROR, valores zero).
   */
  invoiceAllocation?: OrderInvoiceAllocationForNfe | null;
}): CommissionOrderSnapshotDraft {
  const nfeId = pickPrimaryNfeId(input.order, input.nfeId);
  const saleDate = resolveCommissionRuleReferenceDate(input.order, nfeId);
  const itemNamesById = new Map(
    input.order.items.map((item) => [item.localItemId, item.productName])
  );
  const basis: InvoiceAllocationBasis = input.invoiceAllocation?.basis ?? "FULL_ORDER_LEGACY";

  type AdjustedLine = {
    line: CommissionOrderItemCalculationResult;
    soldAmount: number;
    grossCommissionAmount: number;
    finalCommissionAmount: number;
    status: CommissionOrderItemSnapshotStatusValue;
    exclusionReason: string | null;
    allocation?: Pick<
      CommissionOrderItemSnapshotDraft,
      | "orderedQuantity"
      | "invoicedQuantity"
      | "cumulativeInvoicedQuantity"
      | "itemFullSoldAmount"
      | "itemFullCommissionAmount"
      | "allocationEvidence"
    >;
  };
  const adjusted: AdjustedLine[] = [];
  for (const line of input.lines) {
    const status = toCommissionOrderItemSnapshotStatus(line.status);
    if (basis === "FULL_ORDER_LEGACY") {
      adjusted.push({
        line,
        soldAmount: line.soldAmount,
        grossCommissionAmount: line.grossCommissionAmount,
        finalCommissionAmount: line.netCommissionAmount,
        status,
        exclusionReason: line.exclusionReason,
      });
      continue;
    }
    if (basis === "ALLOCATION_PENDING") {
      // Retido: nada de comissão sem evidência por item (nunca o pedido inteiro).
      adjusted.push({
        line,
        soldAmount: 0,
        grossCommissionAmount: 0,
        finalCommissionAmount: 0,
        status: "ERROR",
        exclusionReason: `ALOCACAO_PENDENTE: ${input.invoiceAllocation?.reason ?? "sem evidência de faturamento por item"}`,
        allocation: {
          itemFullSoldAmount: line.soldAmount,
          itemFullCommissionAmount: line.netCommissionAmount,
        },
      });
      continue;
    }
    const item = input.invoiceAllocation!.items.get(line.itemId);
    if (!item) continue; // item não faturado nesta NF-e
    const share = (fullAmount: number) =>
      allocateItemAmountByQuantity({
        fullAmount,
        orderedQuantity: item.orderedQuantity,
        cumulativeBefore: item.cumulativeBefore,
        cumulativeAfter: item.cumulativeAfter,
      });
    adjusted.push({
      line,
      soldAmount: share(line.soldAmount),
      grossCommissionAmount: share(line.grossCommissionAmount),
      finalCommissionAmount: share(line.netCommissionAmount),
      status,
      exclusionReason: line.exclusionReason,
      allocation: {
        orderedQuantity: item.orderedQuantity,
        invoicedQuantity: item.invoicedQuantity,
        cumulativeInvoicedQuantity: item.cumulativeAfter,
        itemFullSoldAmount: line.soldAmount,
        itemFullCommissionAmount: line.netCommissionAmount,
        allocationEvidence: item.evidence,
      },
    });
  }

  const hashItems = adjusted.map((row) => ({
    ...mapCalculationResultToItemHashInput(row.line),
    soldAmount: row.soldAmount,
    grossCommissionAmount: row.grossCommissionAmount,
    finalCommissionAmount: row.finalCommissionAmount,
    status: row.status,
  }));
  const totals = aggregateOrderSnapshotTotals(hashItems);
  const baseHash = buildCommissionOrderSnapshotSourceHash({
    salesOrderId: input.order.localOrderId,
    nfeId,
    saleDate: saleDate.toISOString(),
    rawSellerId: input.order.seller.nomusSellerId,
    canonicalSellerId: input.sellerResolution.canonicalSellerId,
    items: hashItems,
  });
  // Base histórica: hash idêntico ao de antes (não força rematerialização em massa).
  const sourceHash =
    basis === "FULL_ORDER_LEGACY"
      ? baseHash
      : createHash("sha256")
          .update(
            [
              baseHash,
              "allocation",
              basis,
              ...adjusted
                .map((row) => `${row.line.itemId}:${row.allocation?.invoicedQuantity ?? ""}:${row.allocation?.cumulativeInvoicedQuantity ?? ""}`)
                .sort(),
            ].join("|")
          )
          .digest("hex");

  const items: CommissionOrderItemSnapshotDraft[] = adjusted.map((row) => {
    const { line, status } = row;
    return {
      salesOrderItemId: line.itemId,
      productId: line.productId,
      productNameSnapshot: itemNamesById.get(line.itemId) ?? line.productId,
      soldAmount: row.soldAmount,
      marginPercent: line.marginPercent,
      commissionRatePercent: line.commissionRatePercent,
      grossCommissionAmount: row.grossCommissionAmount,
      finalCommissionAmount: row.finalCommissionAmount,
      ruleId: line.ruleId,
      ruleSnapshotJson: line.ruleSnapshot,
      exclusionReason: row.exclusionReason,
      status,
      sourceHash: buildCommissionOrderItemSnapshotSourceHash({
        salesOrderId: input.order.localOrderId,
        nfeId,
        salesOrderItemId: line.itemId,
        productId: line.productId,
        soldAmount: row.soldAmount,
        marginPercent: line.marginPercent,
        commissionRatePercent: line.commissionRatePercent,
        grossCommissionAmount: row.grossCommissionAmount,
        finalCommissionAmount: row.finalCommissionAmount,
        ruleId: line.ruleId,
        status,
      }),
      ...(row.allocation ?? {}),
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
    allocationBasis: basis,
    allocationReason: input.invoiceAllocation?.reason ?? null,
    items,
  };
}
