/**
 * KPIs de comparação comercial: preço oficial de tabela vs preço vendido vs custo oficial.
 * Não altera margem realizada — apenas enriquece payload de referência.
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import type {
  SalesOrderMarginCommercialReference,
  SalesOrderMarginCommercialReferenceStatus,
  SalesOrderMarginItemResult,
  SalesOrderMarginOfficialPriceMeta,
  SalesOrderMarginProductionCostMeta,
} from "./salesOrderMarginTypes.js";

export type OfficialPriceTableItemSnapshot = {
  priceTableItemId: string;
  salePrice: number;
  frozenTotalCost: number | null;
};

export function buildSalesOrderMarginCommercialReference(input: {
  item: Pick<
    SalesOrderMarginItemResult,
    | "quantity"
    | "netUnitRevenue"
    | "netRevenue"
    | "unitCost"
    | "totalCost"
    | "marginValue"
    | "marginPercent"
    | "status"
  >;
  productionCost?: SalesOrderMarginProductionCostMeta | null;
  officialPrice?: SalesOrderMarginOfficialPriceMeta | null;
  officialPriceItem?: OfficialPriceTableItemSnapshot | null;
  productType?: string | null;
}): SalesOrderMarginCommercialReference {
  const quantity = Number.isFinite(input.item.quantity) ? input.item.quantity : 0;
  const soldUnitPrice =
    input.item.netUnitRevenue != null && Number.isFinite(input.item.netUnitRevenue)
      ? input.item.netUnitRevenue
      : quantity > 0 && input.item.netRevenue > 0
        ? roundPricingMoney(input.item.netRevenue / quantity)
        : null;

  const officialCost =
    input.item.unitCost != null && Number.isFinite(input.item.unitCost)
      ? input.item.unitCost
      : null;

  const officialUnitPrice =
    input.officialPriceItem != null && Number.isFinite(input.officialPriceItem.salePrice)
      ? input.officialPriceItem.salePrice
      : null;

  let referenceStatus: SalesOrderMarginCommercialReferenceStatus = "OK";

  if (input.item.status === "RECEITA_INVALIDA" || (soldUnitPrice != null && soldUnitPrice <= 0)) {
    referenceStatus = "RECEITA_INVALIDA";
  } else if (officialCost == null) {
    referenceStatus =
      input.item.status === "SEM_CUSTO" || input.item.status === "CUSTO_ZERO"
        ? "SEM_CUSTO"
        : "CUSTO_INDISPONIVEL";
  } else if (!input.officialPrice?.priceTableId) {
    referenceStatus = "SEM_PRECO_TABELA";
  } else if (officialUnitPrice == null || officialUnitPrice <= 0) {
    referenceStatus = "PRECO_INDISPONIVEL";
  }

  const discountVsOfficialPrice =
    officialUnitPrice != null && soldUnitPrice != null
      ? roundPricingMoney(officialUnitPrice - soldUnitPrice)
      : null;

  const discountPercentVsOfficialPrice =
    discountVsOfficialPrice != null && officialUnitPrice != null && officialUnitPrice > 0
      ? roundPricingPercent((discountVsOfficialPrice / officialUnitPrice) * 100)
      : null;

  const realizedMarginAmount = input.item.marginValue;
  const realizedMarginPercent = input.item.marginPercent;

  let tableMarginAmount: number | null = null;
  let tableMarginPercent: number | null = null;
  let marginLeakageAmount: number | null = null;

  if (
    officialUnitPrice != null &&
    officialCost != null &&
    quantity > 0 &&
    referenceStatus === "OK"
  ) {
    const tableUnitMargin = roundPricingMoney(officialUnitPrice - officialCost);
    tableMarginAmount = roundPricingMoney(tableUnitMargin * quantity);
    tableMarginPercent =
      officialUnitPrice > 0
        ? roundPricingPercent((tableUnitMargin / officialUnitPrice) * 100)
        : null;

    if (realizedMarginAmount != null) {
      marginLeakageAmount = roundPricingMoney(tableMarginAmount - realizedMarginAmount);
    }
  }

  return {
    officialCost,
    soldUnitPrice,
    officialUnitPrice,
    discountVsOfficialPrice,
    discountPercentVsOfficialPrice,
    realizedMarginAmount,
    realizedMarginPercent,
    tableMarginAmount,
    tableMarginPercent,
    marginLeakageAmount,
    referenceStatus,
    productionCost: input.productionCost ?? null,
    officialPrice: input.officialPrice ?? null,
    productType: input.productType ?? null,
  };
}
