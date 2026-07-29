/**
 * Margem da listagem de Propostas — mesma margem comercial total do formulário
 * (formação congelada + preço líquido; total ponderado pelo líquido).
 *
 * A margem oficial de produção (Pedido) permanece em `resolveProposalOfficialMarginFromItems`
 * para persistência / PDF interno.
 */
import { previewProposalCommercialMargins } from "./proposalCommercialMarginPreview.js";
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.js";

export type ProposalListMarginItemInput = {
  quantity?: unknown;
  negotiatedPrice?: unknown;
  suggestedPrice?: unknown;
  discountPerc?: unknown;
  discountValue?: unknown;
  taxesPerc?: unknown;
  unitCost?: unknown;
  commissionPerc?: unknown;
  freightValue?: unknown;
  pricingSnapshotJson?: unknown;
  commercialPricingSnapshotJson?: unknown;
  priceTableId?: unknown;
  priceTableVersionId?: unknown;
  priceSource?: unknown;
  productId?: unknown;
};

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNullableNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Recalcula margem oficial (produção) a partir dos itens.
 * `unitCost` deve já ser o custo de produção vigente (anexado no server).
 */
export function resolveProposalOfficialMarginFromItems(
  items: ReadonlyArray<ProposalListMarginItemInput> | null | undefined
): {
  totalMarginValue: number | null;
  totalMarginPerc: number | null;
  totalNetSalesAmount: number;
  totalCost: number | null;
  itemCount: number;
} {
  const rows = Array.isArray(items) ? items : [];
  const lineMargins = rows.map((item) => {
    const quantity = safeNum(item.quantity);
    const unitCost = toNullableCost(item.unitCost);
    const productId =
      typeof item.productId === "string" ? item.productId.trim() : null;
    return {
      ...calculateProposalLineMargin({
        quantity,
        negotiatedPrice: safeNum(item.negotiatedPrice),
        discountValue: safeNum(item.discountValue),
        taxesPerc: safeNum(item.taxesPerc),
        unitCost,
        productId,
      }),
      // CUSTO_ZERO / ausente: não soma custo fictício no consolidado
      lineCost:
        unitCost == null || unitCost <= 0
          ? null
          : quantity * unitCost,
    };
  });
  const summary = calculateProposalMarginSummary(lineMargins);
  let totalCost: number | null = 0;
  let anyCost = false;
  for (const row of lineMargins) {
    if (row.lineCost == null) {
      totalCost = null;
      break;
    }
    anyCost = true;
    totalCost += row.lineCost;
  }
  if (!anyCost) totalCost = null;

  return {
    totalMarginValue: summary.totalMarginValue,
    totalMarginPerc: summary.totalMarginPerc,
    totalNetSalesAmount: summary.totalNetSalesAmount,
    totalCost,
    itemCount: rows.length,
  };
}

/**
 * Margem comercial consolidada — paridade com `commercialPreview.view` do formulário.
 */
export function resolveProposalCommercialMarginFromItems(
  items: ReadonlyArray<ProposalListMarginItemInput> | null | undefined
): {
  totalMarginValue: number | null;
  totalMarginPerc: number | null;
  itemCount: number;
} {
  const rows = Array.isArray(items) ? items : [];
  const preview = previewProposalCommercialMargins(
    rows.map((item) => ({
      productId:
        typeof item.productId === "string" ? item.productId : null,
      quantity: safeNum(item.quantity),
      suggestedPrice: toNullableNum(item.suggestedPrice),
      negotiatedPrice: safeNum(item.negotiatedPrice),
      discountPerc: toNullableNum(item.discountPerc),
      discountValue: toNullableNum(item.discountValue),
      priceTableId:
        typeof item.priceTableId === "string" ? item.priceTableId : null,
      priceTableVersionId:
        typeof item.priceTableVersionId === "string"
          ? item.priceTableVersionId
          : null,
      priceSource:
        typeof item.priceSource === "string" ? item.priceSource : null,
      commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
      pricingSnapshotJson: item.pricingSnapshotJson,
    }))
  );

  return {
    totalMarginValue: preview.summary.proposalCommercialMarginTotalValue,
    totalMarginPerc: preview.summary.proposalCommercialMarginTotalPercent,
    itemCount: rows.length,
  };
}

/**
 * Anexa margem comercial ao DTO de listagem (mesma do formulário).
 * Sem itens: preserva totais persistidos (legado).
 */
export function enrichProposalListRowMargin<T extends Record<string, unknown>>(
  proposal: T & {
    items?: ReadonlyArray<ProposalListMarginItemInput> | null;
    totalMarginPerc?: unknown;
    totalMarginValue?: unknown;
  }
): T & {
  totalMarginPerc: number | null;
  totalMarginValue: number | null;
  marginSource: "ITEMS" | "HEADER" | "NONE";
} {
  const items = proposal.items;
  if (Array.isArray(items) && items.length > 0) {
    const resolved = resolveProposalCommercialMarginFromItems(items);
    const { items: _omit, ...rest } = proposal as T & {
      items?: unknown;
    };
    return {
      ...(rest as T),
      totalMarginPerc: resolved.totalMarginPerc,
      totalMarginValue: resolved.totalMarginValue,
      marginSource: "ITEMS",
    };
  }

  const headerPerc = Number(proposal.totalMarginPerc);
  const headerValue = Number(proposal.totalMarginValue);
  const hasHeader =
    Number.isFinite(headerPerc) || Number.isFinite(headerValue);
  const { items: _omit2, ...rest2 } = proposal as T & { items?: unknown };
  return {
    ...(rest2 as T),
    totalMarginPerc: Number.isFinite(headerPerc) ? headerPerc : null,
    totalMarginValue: Number.isFinite(headerValue) ? headerValue : null,
    marginSource: hasHeader ? "HEADER" : "NONE",
  };
}
