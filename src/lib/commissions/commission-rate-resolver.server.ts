/**
 * Resolve percentual de comissão para um item — fixo ou por faixa comercial.
 */
import type { CommissionAuditIssueType, PrismaClient } from "@prisma/client";
import { getEffectiveProductProductionCost } from "../productionCostTables.server.js";
import { CommercialTierCache } from "./commission-commercial-tier.server.js";
import {
  commercialTierAuditMessage,
  resolveCommercialPriceTier,
  resolveSoldUnitNetPrice,
  type ResolveCommercialTierErrorCode,
} from "./commission-commercial-tier.js";
import {
  OUT_OF_TABLE_PRICE_AUDIT_MESSAGE,
  OUT_OF_TABLE_PRICE_AUDIT_TYPE,
} from "./commissionOutOfTable.js";
import { buildAuditIssueKey } from "./commission-calculation-hash.js";
import type {
  CommissionAuditIssueDraft,
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
  CommissionRuleMatchResult,
} from "./commission-types.js";

export type CommissionRateResolution =
  | {
      ok: true;
      ratePercent: number;
      metadata: Record<string, unknown>;
      auditWarning?: CommissionAuditIssueDraft;
    }
  | {
      ok: false;
      auditIssue: CommissionAuditIssueDraft;
    };

function buildCommercialTierAuditIssue(input: {
  type: ResolveCommercialTierErrorCode | "MISSING_OFFICIAL_PRODUCT_COST" | typeof OUT_OF_TABLE_PRICE_AUDIT_TYPE;
  order: CommissionOrderSourceBundle;
  item: CommissionOrderItemSource;
  message: string;
  metadata?: Record<string, unknown>;
}): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: input.type,
      entityType: "SalesOrderItem",
      entityId: input.item.localItemId,
    }),
    severity: "WARNING",
    type: input.type as CommissionAuditIssueType,
    entityType: "SalesOrderItem",
    entityId: input.item.localItemId,
    message: input.message,
    metadataJson: {
      orderCode: input.order.orderCode,
      productCode: input.item.productCode,
      productId: input.item.localProductId,
      ...input.metadata,
    },
  };
}

export async function resolveCommissionRateForItem(
  db: PrismaClient,
  input: {
    match: CommissionRuleMatchResult;
    order: CommissionOrderSourceBundle;
    item: CommissionOrderItemSource;
    referenceDate: Date;
    tierCache: CommercialTierCache;
  }
): Promise<CommissionRateResolution> {
  if (input.match.calculationType !== "COMMERCIAL_PRICE_TIER") {
    return {
      ok: true,
      ratePercent: input.match.ratePercent,
      metadata: { calculationType: "FIXED_PERCENT" },
    };
  }

  const productId = input.item.localProductId;
  if (!productId) {
    return {
      ok: false,
      auditIssue: buildCommercialTierAuditIssue({
        type: "NO_COMMERCIAL_PRICE_TABLE",
        order: input.order,
        item: input.item,
        message: "Item do pedido sem produto local vinculado para consultar tabelas comerciais.",
      }),
    };
  }

  const officialCost = await getEffectiveProductProductionCost(
    db,
    productId,
    input.referenceDate
  );
  if (officialCost.status !== "OK" || officialCost.unitProductionCost == null) {
    return {
      ok: false,
      auditIssue: buildCommercialTierAuditIssue({
        type: "MISSING_OFFICIAL_PRODUCT_COST",
        order: input.order,
        item: input.item,
        message: `Produto ${input.item.productCode} sem custo oficial IndusCost vigente na data do pedido.`,
        metadata: {
          referenceDate: input.referenceDate.toISOString(),
          costStatus: officialCost.status,
        },
      }),
    };
  }

  const tierLoad = await input.tierCache.get(productId, input.referenceDate);
  if (!tierLoad.ok) {
    return {
      ok: false,
      auditIssue: buildCommercialTierAuditIssue({
        type: "NO_COMMERCIAL_PRICE_TABLE",
        order: input.order,
        item: input.item,
        message: `Produto ${input.item.productCode} sem tabela comercial publicada (${tierLoad.missingCodes.join(", ")}).`,
        metadata: { missingCodes: tierLoad.missingCodes },
      }),
    };
  }

  const soldUnitPrice = resolveSoldUnitNetPrice(input.item);
  const tierResult = resolveCommercialPriceTier({
    soldUnitPrice,
    tiers: tierLoad.tiers,
  });

  if (!tierResult.ok) {
    return {
      ok: false,
      auditIssue: buildCommercialTierAuditIssue({
        type: tierResult.code,
        order: input.order,
        item: input.item,
        message: tierResult.message || commercialTierAuditMessage(tierResult.code),
        metadata: {
          soldUnitPrice,
          tiers: tierResult.tiers?.map((t) => ({
            code: t.code,
            name: t.name,
            salePrice: t.salePrice,
            commissionPercent: t.commissionPercent,
          })),
        },
      }),
    };
  }

  const metadata: Record<string, unknown> = {
    calculationType: "COMMERCIAL_PRICE_TIER",
    tierCode: tierResult.tierCode,
    tierName: tierResult.tierName,
    referenceSalePrice: tierResult.referenceSalePrice,
    soldUnitPrice: tierResult.soldUnitPrice,
    officialUnitProductionCost: officialCost.unitProductionCost,
    officialCostTableVersionId: officialCost.costTableVersionId,
    officialCostTableCode: officialCost.versionCode,
    officialCostTableRevision: officialCost.revision,
    tiersCompared: tierResult.tiersUsed.map((t) => ({
      code: t.code,
      name: t.name,
      salePrice: t.salePrice,
      commissionPercent: t.commissionPercent,
    })),
  };

  let auditWarning: CommissionAuditIssueDraft | undefined;

  if (tierResult.outOfTablePrice) {
    metadata.outOfTablePrice = true;
    metadata.warningCode = tierResult.warningCode;
    metadata.atacadoPrice = tierResult.atacadoPrice;
    metadata.differenceAmount = tierResult.differenceAmount;
    metadata.differencePercent = tierResult.differencePercent;
    metadata.appliedCommissionPercent = tierResult.ratePercent;
    metadata.appliedTier = tierResult.tierCode;

    auditWarning = buildCommercialTierAuditIssue({
      type: OUT_OF_TABLE_PRICE_AUDIT_TYPE,
      order: input.order,
      item: input.item,
      message: OUT_OF_TABLE_PRICE_AUDIT_MESSAGE,
      metadata: {
        productId: input.item.localProductId,
        productCode: input.item.productCode,
        productName: input.item.productName,
        salesOrderId: input.order.localOrderId,
        salesOrderCode: input.order.orderCode,
        soldUnitPrice: tierResult.soldUnitPrice,
        atacadoPrice: tierResult.atacadoPrice,
        differenceAmount: tierResult.differenceAmount,
        differencePercent: tierResult.differencePercent,
        appliedCommissionPercent: tierResult.ratePercent,
        appliedTier: tierResult.tierCode,
      },
    });
  }

  return {
    ok: true,
    ratePercent: tierResult.ratePercent,
    metadata,
    auditWarning,
  };
}
