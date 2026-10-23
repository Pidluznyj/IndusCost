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
  resolveMaterializationNfeId,
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
import { resolveOrderCommissionSeller } from "./commissionNomusOrderSellerResolver.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import type { OrderInvoiceAllocation } from "./commissionInvoiceAllocation.js";
import {
  isCommissionInvoiceAllocationEnabled,
  loadOrderInvoiceAllocation,
} from "./commissionInvoiceAllocation.server.js";

export class SalesOrderNotFoundError extends Error {
  constructor(public readonly salesOrderId: string) {
    super(`Pedido de venda não encontrado: ${salesOrderId}`);
    this.name = "SalesOrderNotFoundError";
  }
}

export class SalesOrderCustomerMissingError extends Error {
  constructor(public readonly salesOrderId: string) {
    super(`Pedido de venda sem cliente vinculado: ${salesOrderId}`);
    this.name = "SalesOrderCustomerMissingError";
  }
}

export type MaterializeCommissionForSalesOrderInput = {
  salesOrderId: string;
  /** NF específica vinculada ao recebimento — sobrescreve a NF primária do pedido. */
  nfeId?: number | null;
  reason?: string | null;
  dryRun?: boolean;
  /** Injeção em teste; padrão = documentos de saída oficiais do banco. */
  loadInvoiceAllocation?: (db: PrismaClient, bundle: CommissionOrderSourceBundle) => Promise<OrderInvoiceAllocation>;
  /**
   * Memória de UMA execução do orquestrador: pedido com N NF-e carrega a origem, as
   * regras e a alocação uma vez (antes: uma vez por par pedido × NF-e). Só leituras de
   * origem que as gravações de snapshot/schedule da própria execução não alteram.
   */
  runCache?: CommissionMaterializationRunCache;
};

export type CommissionMaterializationRunCache = {
  sources: Map<string, Promise<Awaited<ReturnType<typeof loadCommissionOrderSourceBySalesOrderId>>>>;
  allocations: Map<string, Promise<OrderInvoiceAllocation>>;
  globals: Promise<OrderCalculationGlobals> | null;
};

export function createCommissionMaterializationRunCache(): CommissionMaterializationRunCache {
  return { sources: new Map(), allocations: new Map(), globals: null };
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const cached = map.get(key);
  if (cached) return cached;
  const promise = load();
  map.set(key, promise);
  // Falha não fica em cache: a próxima tentativa recarrega.
  promise.catch(() => map.delete(key));
  return promise;
}

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
    allocationBasis: draft.allocationBasis ?? "FULL_ORDER_LEGACY",
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
        ...(item.orderedQuantity != null ? { orderedQuantity: toPrismaDecimal(item.orderedQuantity) } : {}),
        ...(item.invoicedQuantity != null ? { invoicedQuantity: toPrismaDecimal(item.invoicedQuantity) } : {}),
        ...(item.cumulativeInvoicedQuantity != null
          ? { cumulativeInvoicedQuantity: toPrismaDecimal(item.cumulativeInvoicedQuantity) }
          : {}),
        ...(item.itemFullSoldAmount != null ? { itemFullSoldAmount: toPrismaDecimal(item.itemFullSoldAmount) } : {}),
        ...(item.itemFullCommissionAmount != null
          ? { itemFullCommissionAmount: toPrismaDecimal(item.itemFullCommissionAmount) }
          : {}),
        ...(item.allocationEvidence ? { allocationEvidenceJson: item.allocationEvidence } : {}),
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

type OrderCalculationGlobals = {
  rules: Awaited<ReturnType<typeof loadActiveCommissionRules>>;
  exclusionRules: Awaited<ReturnType<typeof loadActiveCustomerExclusionRuleSnapshots>>;
  sellerIdentity: Awaited<ReturnType<typeof loadCommissionSellerIdentityContext>>;
};

async function loadOrderCalculationGlobals(db: PrismaClient): Promise<OrderCalculationGlobals> {
  const [rules, exclusionRules, sellerIdentity] = await Promise.all([
    loadActiveCommissionRules(db),
    loadActiveCustomerExclusionRuleSnapshots(),
    loadCommissionSellerIdentityContext(db),
  ]);
  return { rules, exclusionRules, sellerIdentity };
}

async function loadOrderCalculationContext(
  db: PrismaClient,
  order: CommissionOrderSourceBundle,
  preferredNfeId?: number | null,
  globals?: Promise<OrderCalculationGlobals>
): Promise<CommissionOrderCalculationContext> {
  const { rules, exclusionRules, sellerIdentity } = await (globals ?? loadOrderCalculationGlobals(db));

  const nfeId =
    resolveMaterializationNfeId(order, preferredNfeId) ??
    order.authorizedOutputNfes[0]?.nfeExternalId ??
    null;
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

  const persist = () => db.$transaction(async (tx) => {
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

    // sourceHash é único global: a origem que volta a um estado anterior (ex.: alocação
    // B5 desligada e religada, regra revertida) reativa o snapshot idêntico já gravado
    // em vez de recriá-lo — mesmo padrão dos schedules (toReactivate).
    const identical = await tx.commissionOrderSnapshot.findUnique({
      where: { sourceHash: input.draft.sourceHash },
      select: { id: true, salesOrderId: true, nfeId: true },
    });
    if (identical) {
      if (identical.salesOrderId !== input.draft.salesOrderId || (identical.nfeId ?? null) !== (input.draft.nfeId ?? null)) {
        throw new Error(
          `sourceHash do snapshot já pertence a outro pedido/NF-e (${identical.salesOrderId}/${identical.nfeId ?? "-"}): materialização recusada.`
        );
      }
      return tx.commissionOrderSnapshot.update({
        where: { id: identical.id },
        data: { status: "ACTIVE" },
        select: { id: true },
      });
    }

    return tx.commissionOrderSnapshot.create({
      data: mapDraftToCreateData(input.draft),
      select: { id: true },
    });
  });

  let created: { id: string };
  try {
    created = await persist();
  } catch (error) {
    // Corrida entre dois processos materializando a mesma origem: o outro gravou o
    // snapshot idêntico (mesmo sourceHash) primeiro. Se ele é o vigente deste
    // (pedido, NF-e), o resultado é o mesmo — idempotente, sem erro.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await db.commissionOrderSnapshot.findUnique({
      where: { sourceHash: input.draft.sourceHash },
      select: { id: true, salesOrderId: true, nfeId: true, status: true },
    });
    if (
      !winner ||
      winner.status !== "ACTIVE" ||
      winner.salesOrderId !== input.draft.salesOrderId ||
      (winner.nfeId ?? null) !== (input.draft.nfeId ?? null)
    ) {
      throw error;
    }
    return {
      action: "unchanged",
      snapshotId: winner.id,
      previousSnapshotId: null,
      sourceHash: input.draft.sourceHash,
      dryRun: false,
      preview,
    };
  }

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
  const cache = input.runCache ?? null;
  const loaded = cache
    ? await memo(cache.sources, input.salesOrderId, () => loadCommissionOrderSourceBySalesOrderId(db, input.salesOrderId))
    : await loadCommissionOrderSourceBySalesOrderId(db, input.salesOrderId);
  if (!loaded) {
    throw new SalesOrderNotFoundError(input.salesOrderId);
  }

  const { bundle, customerId } = loaded;
  if (!customerId) {
    throw new SalesOrderCustomerMissingError(input.salesOrderId);
  }
  const preferredNfeId = input.nfeId ?? null;
  if (cache && !cache.globals) {
    cache.globals = loadOrderCalculationGlobals(db);
    cache.globals.catch(() => {
      cache.globals = null;
    });
  }
  const context = await loadOrderCalculationContext(db, bundle, preferredNfeId, cache?.globals ?? undefined);
  const lines = calculateCommissionForSalesOrderItems({ orders: [bundle], context });
  const { identity: sellerResolution } = resolveOrderCommissionSeller({
    externalSellerId: bundle.seller.nomusSellerId,
    issueDate: bundle.issueDate,
    nomusSellerName: bundle.seller.responsibleName,
    aliasSource: "NOMUS_ORDER",
    identityCtx: context.sellerIdentity,
  });

  // B5: o snapshot (pedido, NF-e) mede só o que a NF-e faturou, por evidência
  // oficial do documento de saída. Desligável por COMMISSION_INVOICE_ALLOCATION_ENABLED=false.
  const targetNfeId = resolveMaterializationNfeId(bundle, preferredNfeId);
  const invoiceAllocation =
    isCommissionInvoiceAllocationEnabled() && targetNfeId != null
      ? (
          await (cache
            ? memo(cache.allocations, input.salesOrderId, () => (input.loadInvoiceAllocation ?? loadOrderInvoiceAllocation)(db, bundle))
            : (input.loadInvoiceAllocation ?? loadOrderInvoiceAllocation)(db, bundle))
        ).byNfe.get(targetNfeId) ?? null
      : null;

  const draft = buildCommissionOrderSnapshotDraft({
    order: bundle,
    customerId,
    customerNameSnapshot: bundle.customerName,
    lines,
    sellerResolution,
    nfeId: preferredNfeId,
    invoiceAllocation,
  });

  const existingActive = await findActiveOrderSnapshot(db, draft.salesOrderId, draft.nfeId);

  return persistCommissionOrderMaterialization(db, {
    draft,
    existingActive,
    dryRun: input.dryRun ?? false,
  });
}
