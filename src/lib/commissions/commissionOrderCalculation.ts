/**
 * Cálculo puro de comissão na venda (Pedido/NF) — sem persistência.
 *
 * Fontes canônicas reutilizadas:
 * - Preço vendido: SalesOrderItem.totalNetValue → CommissionOrderItemSource.itemNetAmount
 *   (resolveSoldUnitNetPrice para enquadramento na tabela comercial).
 * - Margem IndusCost: salesOrderMarginMath.calculateSalesOrderItemMargin com unitCost
 *   de custo de produção oficial (VERSIONED_PRODUCTION_COST / getEffectiveProductProductionCost).
 * - Tabela comercial publicada: priceTable ATACADO/VAREJO_* + priceTableVersion PUBLISHED
 *   (commission-commercial-tier.server — aqui injetada via commercialTiersByProductId).
 * - Regra vigente: commission-rule-engine.selectBestMatchingRule na data NF ou pedido
 *   (resolveCommissionRuleReferenceDate).
 * - Vendedor canônico: commissionNomusOrderSellerResolver.resolveOrderCommissionSeller.
 * - Exclusão de cliente: commissionCustomerExclusionApply.
 */
import { buildRuleMatchContext } from "./commission-calculation-hash.js";
import {
  buildCommercialTierMetadata,
  resolveCommercialPriceTier,
  resolveSoldUnitNetPrice,
  type CommercialPriceTierRow,
} from "./commission-commercial-tier.js";
import {
  applyCustomerExclusionToCommission,
  resolveCustomerExclusionForSale,
} from "./commissionCustomerExclusionApply.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import { computeCommissionAmount, roundMoney } from "./commission-money.js";
import { selectBestMatchingRule } from "./commission-rule-engine.js";
import {
  resolveCommissionRuleReferenceDate,
  type CommissionOrderSourceBundle,
} from "./commission-source-resolver.js";
import {
  isNomusOrderSellerResolved,
  resolveOrderCommissionSeller,
  type NomusOrderSellerResolution,
} from "./commissionNomusOrderSellerResolver.js";
import type {
  CommissionSellerIdentityContext,
  CommissionSellerIdentityResolution,
} from "./commissionSellerIdentity.js";
import {
  serializeCommissionRuleSnapshot,
  type CommissionRuleSnapshot,
} from "./commissionReceiptLedger.js";
import type { CommissionActiveRule, CommissionRuleMatchResult } from "./commission-types.js";
import { calculateSalesOrderItemMargin } from "../salesOrderMarginMath.js";

export type CommissionOrderCalculationStatus =
  | "COMMISSIONABLE"
  | "CUSTOMER_EXCLUDED"
  | "NO_RULE"
  | "SELLER_UNRESOLVED"
  | "NO_COMMERCIAL_PRICE_TABLE"
  | "INVALID_COMMERCIAL_PRICE_RANGE"
  | "NO_COMMISSION_TABLE_RATE";

export type CommissionOrderItemCalculationResult = {
  salesOrderId: string;
  nfeId: number | null;
  itemId: string;
  productId: string;
  soldAmount: number;
  soldUnitPrice: number;
  marginPercent: number | null;
  commissionRatePercent: number;
  grossCommissionAmount: number;
  netCommissionAmount: number;
  ruleId: string | null;
  ruleSnapshot: CommissionRuleSnapshot | null;
  exclusionStatus: "NONE" | "EXCLUDED";
  exclusionReason: string | null;
  status: CommissionOrderCalculationStatus;
  statusReason: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  referenceDate: string;
  tierMetadata: Record<string, unknown> | null;
};

export type CommissionOrderCalculationContext = {
  rules: CommissionActiveRule[];
  exclusionRules: CustomerExclusionRuleSnapshot[];
  sellerIdentity: CommissionSellerIdentityContext;
  /** Faixas publicadas por productId local (Formação de Preço). */
  commercialTiersByProductId: Map<string, CommercialPriceTierRow[]>;
  /** Custo unitário de produção IndusCost por productId (para margem). */
  unitProductionCostByProductId?: Map<string, number>;
  beneficiaryType?: "SELLER" | "REPRESENTATIVE";
};

function isSellerResolved(
  resolution: CommissionSellerIdentityResolution,
  nomusResolution: NomusOrderSellerResolution
): boolean {
  return isNomusOrderSellerResolved(nomusResolution) && resolution.canonicalSellerId != null;
}

function resolveItemMarginPercent(input: {
  item: CommissionOrderSourceBundle["items"][number];
  unitProductionCost: number | undefined;
}): number | null {
  if (input.unitProductionCost == null || !Number.isFinite(input.unitProductionCost)) {
    return null;
  }
  const margin = calculateSalesOrderItemMargin({
    salesOrderItemId: input.item.localItemId,
    productId: input.item.localProductId,
    productCode: input.item.productCode,
    productName: input.item.productName,
    quantity: input.item.quantity,
    netTotalValue: input.item.itemNetAmount,
    netUnitPrice: resolveSoldUnitNetPrice(input.item),
    unitCost: input.unitProductionCost,
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: "HIGH",
  });
  return margin.marginPercent;
}

function resolvePureCommissionRate(input: {
  match: CommissionRuleMatchResult;
  item: CommissionOrderSourceBundle["items"][number];
  tiers: CommercialPriceTierRow[] | undefined;
}):
  | {
      ok: true;
      ratePercent: number;
      tierMetadata: Record<string, unknown>;
    }
  | {
      ok: false;
      status: CommissionOrderCalculationStatus;
      statusReason: string;
    } {
  if (input.match.calculationType !== "COMMERCIAL_PRICE_TIER") {
    return {
      ok: true,
      ratePercent: input.match.ratePercent,
      tierMetadata: { calculationType: "FIXED_PERCENT" },
    };
  }

  if (!input.tiers || input.tiers.length === 0) {
    return {
      ok: false,
      status: "NO_COMMERCIAL_PRICE_TABLE",
      statusReason: "Produto sem tabela comercial publicada para a data de referência.",
    };
  }

  const soldUnitPrice = resolveSoldUnitNetPrice(input.item);
  const tierResult = resolveCommercialPriceTier({
    soldUnitPrice,
    tiers: input.tiers,
  });

  if (!tierResult.ok) {
    const statusMap: Record<string, CommissionOrderCalculationStatus> = {
      NO_COMMERCIAL_PRICE_TABLE: "NO_COMMERCIAL_PRICE_TABLE",
      INVALID_COMMERCIAL_PRICE_RANGE: "INVALID_COMMERCIAL_PRICE_RANGE",
      NO_COMMISSION_TABLE_RATE: "NO_COMMISSION_TABLE_RATE",
    };
    return {
      ok: false,
      status: statusMap[tierResult.code] ?? "NO_COMMERCIAL_PRICE_TABLE",
      statusReason: tierResult.message,
    };
  }

  return {
    ok: true,
    ratePercent: tierResult.ratePercent,
    tierMetadata: buildCommercialTierMetadata(tierResult),
  };
}

function pickPrimaryNfeId(order: CommissionOrderSourceBundle): number | null {
  return order.authorizedOutputNfes[0]?.nfeExternalId ?? null;
}

function calculateItemCommission(input: {
  order: CommissionOrderSourceBundle;
  item: CommissionOrderSourceBundle["items"][number];
  context: CommissionOrderCalculationContext;
  sellerResolution: CommissionSellerIdentityResolution;
  nomusSellerResolution: NomusOrderSellerResolution;
}): CommissionOrderItemCalculationResult {
  const nfeId = pickPrimaryNfeId(input.order);
  const referenceDate = resolveCommissionRuleReferenceDate(input.order, nfeId);
  const beneficiaryType = input.context.beneficiaryType ?? "SELLER";
  const soldAmount = roundMoney(input.item.itemNetAmount);
  const soldUnitPrice = resolveSoldUnitNetPrice(input.item);
  const unitProductionCost = input.context.unitProductionCostByProductId?.get(
    input.item.localProductId
  );
  const marginPercent = resolveItemMarginPercent({
    item: input.item,
    unitProductionCost,
  });

  const baseResult: Omit<
    CommissionOrderItemCalculationResult,
    | "commissionRatePercent"
    | "grossCommissionAmount"
    | "netCommissionAmount"
    | "ruleId"
    | "ruleSnapshot"
    | "exclusionStatus"
    | "exclusionReason"
    | "status"
    | "statusReason"
    | "tierMetadata"
  > = {
    salesOrderId: input.order.localOrderId,
    nfeId,
    itemId: input.item.localItemId,
    productId: input.item.localProductId,
    soldAmount,
    soldUnitPrice,
    marginPercent,
    canonicalSellerId: input.sellerResolution.canonicalSellerId,
    canonicalSellerName: input.sellerResolution.canonicalSellerName,
    referenceDate: referenceDate.toISOString(),
  };

  if (!isSellerResolved(input.sellerResolution, input.nomusSellerResolution)) {
    const statusReason =
      input.nomusSellerResolution.status === "NO_SELLER"
        ? "Pedido sem vendedor Nomus (externalSellerId ausente)"
        : input.sellerResolution.warnings[0] ??
          `Vendedor não resolvido (${input.nomusSellerResolution.status})`;
    return {
      ...baseResult,
      commissionRatePercent: 0,
      grossCommissionAmount: 0,
      netCommissionAmount: 0,
      ruleId: null,
      ruleSnapshot: null,
      exclusionStatus: "NONE",
      exclusionReason: null,
      status:
        input.nomusSellerResolution.status === "NO_SELLER"
          ? "SELLER_UNRESOLVED"
          : "SELLER_UNRESOLVED",
      statusReason,
      tierMetadata: null,
    };
  }

  const ruleCtx = buildRuleMatchContext(
    input.order,
    input.item,
    beneficiaryType,
    input.sellerResolution.canonicalSellerId,
    referenceDate
  );
  const match = selectBestMatchingRule(input.context.rules, ruleCtx);

  if (!match) {
    return {
      ...baseResult,
      commissionRatePercent: 0,
      grossCommissionAmount: 0,
      netCommissionAmount: 0,
      ruleId: null,
      ruleSnapshot: null,
      exclusionStatus: "NONE",
      exclusionReason: null,
      status: "NO_RULE",
      statusReason: "Nenhuma regra de comissão vigente para o item na data de referência.",
      tierMetadata: null,
    };
  }

  const tiers = input.context.commercialTiersByProductId.get(input.item.localProductId);
  const rateResolution = resolvePureCommissionRate({
    match,
    item: input.item,
    tiers,
  });

  if (!rateResolution.ok) {
    return {
      ...baseResult,
      commissionRatePercent: 0,
      grossCommissionAmount: 0,
      netCommissionAmount: 0,
      ruleId: match.rule.id,
      ruleSnapshot: serializeCommissionRuleSnapshot({
        ...match.rule,
        ratePercent: match.ratePercent,
      }),
      exclusionStatus: "NONE",
      exclusionReason: null,
      status: rateResolution.status,
      statusReason: rateResolution.statusReason,
      tierMetadata: null,
    };
  }

  const grossCommissionAmount = computeCommissionAmount(
    soldAmount,
    rateResolution.ratePercent
  );
  const exclusion = resolveCustomerExclusionForSale({
    customerExternalId: input.order.customerExternalId,
    customerName: input.order.customerName,
    referenceDate,
    rules: input.context.exclusionRules,
  });
  const applied = applyCustomerExclusionToCommission({
    exclusion,
    ratePercent: rateResolution.ratePercent,
    commissionAmount: grossCommissionAmount,
  });

  const ruleSnapshot = serializeCommissionRuleSnapshot({
    ...match.rule,
    ratePercent: rateResolution.ratePercent,
  });

  if (applied.excluded) {
    return {
      ...baseResult,
      commissionRatePercent: 0,
      grossCommissionAmount,
      netCommissionAmount: 0,
      ruleId: match.rule.id,
      ruleSnapshot,
      exclusionStatus: "EXCLUDED",
      exclusionReason:
        exclusion?.reason ?? exclusion?.exclusionMessage ?? "Cliente excluído de comissão",
      status: "CUSTOMER_EXCLUDED",
      statusReason: exclusion?.exclusionMessage ?? exclusion?.reason ?? null,
      tierMetadata: rateResolution.tierMetadata,
    };
  }

  return {
    ...baseResult,
    commissionRatePercent: rateResolution.ratePercent,
    grossCommissionAmount,
    netCommissionAmount: applied.commissionAmount,
    ruleId: match.rule.id,
    ruleSnapshot,
    exclusionStatus: "NONE",
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    tierMetadata: rateResolution.tierMetadata,
  };
}

/**
 * Calcula comissão bruta por item de pedido/NF sem gravar no banco.
 * Uma linha por item × pedido (beneficiário SELLER por padrão).
 */
export function calculateCommissionForSalesOrderItems(input: {
  orders: CommissionOrderSourceBundle[];
  context: CommissionOrderCalculationContext;
}): CommissionOrderItemCalculationResult[] {
  const results: CommissionOrderItemCalculationResult[] = [];

  for (const order of input.orders) {
    const { identity: sellerResolution, nomus: nomusSellerResolution } =
      resolveOrderCommissionSeller({
        externalSellerId: order.seller.nomusSellerId,
        issueDate: order.issueDate,
        nomusSellerName: order.seller.responsibleName,
        aliasSource: "NOMUS_ORDER",
        identityCtx: input.context.sellerIdentity,
      });

    for (const item of order.items) {
      results.push(
        calculateItemCommission({
          order,
          item,
          context: input.context,
          sellerResolution,
          nomusSellerResolution,
        })
      );
    }
  }

  return results;
}
