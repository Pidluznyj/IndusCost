/**
 * Margem da listagem de Propostas — coluna "Margem" = margem comercial
 * (mesma do formulário / save). Preferência:
 * 1) itens com snapshot/formação resolvível → comercial consolidada
 * 2) senão espelho do cabeçalho (`totalMarginPerc` / `totalMarginValue`)
 *
 * A margem oficial de produção permanece em `resolveProposalOfficialMarginFromItems`
 * para custo / PDF interno.
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
 * Usada no save e na listagem quando há dados comerciais nos itens.
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
 * Coluna do grid: comercial dos itens quando disponível; senão cabeçalho.
 * Blank → blank, 0 → 0, negativo → negativo.
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
  marginSource: "COMMERCIAL" | "HEADER" | "NONE";
} {
  const { items: _omit, ...rest } = proposal as T & { items?: unknown };

  const items = Array.isArray(proposal.items) ? proposal.items : null;
  if (items && items.length > 0) {
    const commercial = resolveProposalCommercialMarginFromItems(items);
    if (commercial.totalMarginPerc != null || commercial.totalMarginValue != null) {
      return {
        ...(rest as T),
        totalMarginPerc: commercial.totalMarginPerc,
        totalMarginValue: commercial.totalMarginValue,
        marginSource: "COMMERCIAL",
      };
    }
  }

  const headerPerc = toNullableNum(proposal.totalMarginPerc);
  const headerValue = toNullableNum(proposal.totalMarginValue);
  const hasPerc = headerPerc != null;
  const hasValue = headerValue != null;
  return {
    ...(rest as T),
    totalMarginPerc: hasPerc ? headerPerc : null,
    totalMarginValue: hasValue ? headerValue : null,
    marginSource: hasPerc || hasValue ? "HEADER" : "NONE",
  };
}
