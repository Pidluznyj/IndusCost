import type { Prisma, PrismaClient } from "@prisma/client";
import { getEffectiveProductProductionCost } from "../productionCostTables.server.js";
import type { CommercialPriceTierRow } from "./commission-commercial-tier.js";
import { loadCommercialPriceTiersForProduct } from "./commission-commercial-tier.server.js";
import { loadActiveCommissionRules } from "./commission-rule-engine.js";
import {
  calculateCommissionForSalesOrderItems,
  type CommissionOrderCalculationContext,
} from "./commissionOrderCalculation.js";
import {
  buildCommissionOrderMaterializationPreview,
  buildCommissionOrderSnapshotDraft,
  resolveMaterializationAction,
  type CommissionOrderMaterializationResult,
  type CommissionOrderSnapshotDraft,
} from "./commissionOrderMaterializer.js";
import { toPrismaDecimal } from "./commission-money.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  loadCommissionOrderSourceBySalesOrderId,
  type CommissionOrderSourceBundle,
} from "./commission-source-resolver.server.js";
import { resolveCommissionRuleReferenceDate } from "./commission-source-resolver.js";
import { resolveCommissionSellerIdentity } from "./commissionSellerIdentity.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";

export class SalesOrderNotFoundError extends Error {
  constructor(public readonly salesOrderId: string) {
    super(`Pedido de venda não encontrado: ${salesOrderId}`);
    this.name = "SalesOrderNotFoundError";
  }
}

export type MaterializeCommissionForSalesOrderInput = {
  salesOrderId: string;
  reason?: string | null;
  dryRun?: boolean;
};

type MaterializerDb = Pick<
  PrismaClient,
  "commissionOrderSnapshot" | "$transaction"
>;

function mapDraftToCreateData(
  draft: CommissionOrderSnapshotDraft
): Prisma.CommissionOrderSnapshotCreateInput {
  return {
    salesOrder: { connect: { id: draft.salesOrderId } },
    nfeId: draft.nfeId,
    customer: { connect: { id: draft.customerId } },
    customerNameSnapshot: draft.customerNameSnapshot,
    rawSellerId: draft.rawSellerId,
    rawSellerName: draft.rawSellerName,
    canonicalSeller: draft.canonicalSellerId
      ? { connect: { id: draft.canonicalSellerId } }
      : undefined,
    canonicalSellerName: draft.canonicalSellerName,
    sellerResolutionStatus: draft.sellerResolutionStatus,
    saleDate: draft.saleDate,
    totalSoldAmount: toPrismaDecimal(draft.totalSoldAmount),
    totalGrossCommissionAmount: toPrismaDecimal(draft.totalGrossCommissionAmount),
    totalFinalCommissionAmount: toPrismaDecimal(draft.totalFinalCommissionAmount),
    sourceHash: draft.sourceHash,
    status: "ACTIVE",
    items: {
      create: draft.items.map((item) => ({
        salesOrderItem: { connect: { id: item.salesOrderItemId } },
        product: { connect: { id: item.productId } },
        productNameSnapshot: item.productNameSnapshot,
        soldAmount: toPrismaDecimal(item.soldAmount),
        marginPercent:
          item.marginPercent != null ? toPrismaDecimal(item.marginPercent) : null,
        commissionRatePercent: toPrismaDecimal(item.commissionRatePercent),
        grossCommissionAmount: toPrismaDecimal(item.grossCommissionAmount),
        finalCommissionAmount: toPrismaDecimal(item.finalCommissionAmount),
        rule: item.ruleId ? { connect: { id: item.ruleId } } : undefined,
        ruleSnapshotJson: item.ruleSnapshotJson ?? undefined,
        exclusionReason: item.exclusionReason,
        sourceHash: item.sourceHash,
        status: item.status,
      })),
    },
  };
}

async function findActiveOrderSnapshot(
  db: Pick<PrismaClient, "commissionOrderSnapshot">,
  salesOrderId: string,
  nfeId: number | null
): Promise<{ id: string; sourceHash: string } | null> {
  return db.commissionOrderSnapshot.findFirst({
    where: {
      salesOrderId,
      nfeId,
      status: "ACTIVE",
    },
    select: { id: true, sourceHash: true },
  });
}

async function loadOrderCalculationContext(
  db: PrismaClient,
  order: CommissionOrderSourceBundle
): Promise<CommissionOrderCalculationContext> {
  const [rules, exclusionRules, sellerIdentity] = await Promise.all([
    loadActiveCommissionRules(db),
    loadActiveCustomerExclusionRuleSnapshots(),
    loadCommissionSellerIdentityContext(db),
  ]);

  const nfeId = order.authorizedOutputNfes[0]?.nfeExternalId ?? null;
  const referenceDate = resolveCommissionRuleReferenceDate(order, nfeId);
  const productIds = [...new Set(order.items.map((item) => item.localProductId))];

  const commercialTiersByProductId = new Map<string, CommercialPriceTierRow[]>();
  const unitProductionCostByProductId = new Map<string, number>();

  await Promise.all(
    productIds.map(async (productId) => {
      const [tierLoad, cost] = await Promise.all([
        loadCommercialPriceTiersForProduct(db, productId, referenceDate),
        getEffectiveProductProductionCost(db, productId, referenceDate),
      ]);
      if (tierLoad.ok) {
        commercialTiersByProductId.set(productId, tierLoad.tiers);
      }
      if (cost.status === "OK" && cost.unitProductionCost != null) {
        unitProductionCostByProductId.set(productId, cost.unitProductionCost);
      }
    })
  );

  return {
    rules,
    exclusionRules,
    sellerIdentity,
    commercialTiersByProductId,
    unitProductionCostByProductId,
  };
}

/** Persiste snapshot quando o hash mudou; idempotente quando inalterado. */
export async function persistCommissionOrderMaterialization(
  db: MaterializerDb,
  input: {
    draft: CommissionOrderSnapshotDraft;
    existingActive: { id: string; sourceHash: string } | null;
    dryRun: boolean;
  }
): Promise<CommissionOrderMaterializationResult> {
  const action = resolveMaterializationAction(input.existingActive, input.draft.sourceHash);
  const preview = buildCommissionOrderMaterializationPreview(input.draft);

  if (action === "unchanged") {
    return {
      action,
      snapshotId: input.existingActive!.id,
      previousSnapshotId: null,
      sourceHash: input.draft.sourceHash,
      dryRun: input.dryRun,
      preview,
    };
  }

  if (input.dryRun) {
    return {
      action,
      snapshotId: null,
      previousSnapshotId: input.existingActive?.id ?? null,
      sourceHash: input.draft.sourceHash,
      dryRun: true,
      preview,
    };
  }

  const created = await db.$transaction(async (tx) => {
    if (input.existingActive) {
      await tx.commissionOrderSnapshot.updateMany({
        where: {
          salesOrderId: input.draft.salesOrderId,
          nfeId: input.draft.nfeId,
          status: "ACTIVE",
        },
        data: { status: "SUPERSEDED" },
      });
    }

    return tx.commissionOrderSnapshot.create({
      data: mapDraftToCreateData(input.draft),
      select: { id: true },
    });
  });

  return {
    action,
    snapshotId: created.id,
    previousSnapshotId: input.existingActive?.id ?? null,
    sourceHash: input.draft.sourceHash,
    dryRun: false,
    preview,
  };
}

/**
 * Calcula e grava (ou apenas prevê) o snapshot de comissão de um pedido/NF.
 * Idempotente: mesma sourceHash + snapshot ACTIVE existente → action "unchanged".
 */
export async function materializeCommissionForSalesOrder(
  db: PrismaClient,
  input: MaterializeCommissionForSalesOrderInput
): Promise<CommissionOrderMaterializationResult> {
  const loaded = await loadCommissionOrderSourceBySalesOrderId(db, input.salesOrderId);
  if (!loaded) {
    throw new SalesOrderNotFoundError(input.salesOrderId);
  }

  const { bundle, customerId } = loaded;
  const context = await loadOrderCalculationContext(db, bundle);
  const lines = calculateCommissionForSalesOrderItems({ orders: [bundle], context });
  const sellerResolution = resolveCommissionSellerIdentity(
    {
      rawSellerId: bundle.seller.nomusSellerId,
      rawSellerName: bundle.seller.responsibleName,
      source: "NOMUS_ORDER",
    },
    context.sellerIdentity
  );

  const draft = buildCommissionOrderSnapshotDraft({
    order: bundle,
    customerId,
    customerNameSnapshot: bundle.customerName,
    lines,
    sellerResolution,
  });

  const existingActive = await findActiveOrderSnapshot(db, draft.salesOrderId, draft.nfeId);

  return persistCommissionOrderMaterialization(db, {
    draft,
    existingActive,
    dryRun: input.dryRun ?? false,
  });
}
