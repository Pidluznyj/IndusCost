/**
 * Orquestrador de Matéria-Prima — camada Prisma. Junta:
 * - demanda: população oficial de pedidos de venda (mesma política OP-02 de
 *   materialDemandFilters.ts) × explosão de BOM (mesmo motor Open Book de
 *   openBookMaterialExplosion.server.ts), multiplicada pela quantidade AINDA
 *   EM ABERTO por item (nomusQuantityPending, líquida de corte/cancelamento
 *   — não a quantidade cheia do pedido);
 * - estoque: Material.quantity/minimumQuantity/contingencyQuantity/
 *   lastStockConferenceAt (mesmos campos já usados na listagem de
 *   Suprimentos);
 * - entradas confirmadas: PurchaseOrderItem em pedidos de compra
 *   APROVADO/ENVIADO/EMITIDO/CONFIRMADO/PARCIALMENTE_RECEBIDO, líquidas do
 *   já recebido (PurchaseReceiptItem.quantityAccepted);
 * - lead time: média histórica de PurchaseOrderItem.leadTimeDaysSnapshot do
 *   material (qualquer status — é evidência histórica, não projeção).
 *
 * Nenhum cálculo de negócio acontece aqui — só busca/agrega dados e chama a
 * engine pura de rawMaterialPlanning.shared.ts.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import { buildOpenBookRawMaterialExplosionPerUnit } from "./openBookMaterialExplosion.server.js";
import type { ExplosionRowCore } from "./openBookMaterialExplosion.js";
import {
  buildMaterialDemandSalesOrderWhere,
  type MaterialDemandFilters,
} from "./materialDemandFilters.js";
import { normalizeMaterialUnitKey } from "./materialDemandUnits.js";
import {
  calculateBuyByDate,
  calculatePlanningConfidence,
  calculatePurchaseRecommendation,
  classifyRawMaterialPlanningStatus,
  projectRawMaterialBalance,
  resolveRawMaterialNeedByDate,
  resolveRawMaterialPlanningHorizonEndDate,
  resolveStockCountAgeDays,
  RAW_MATERIAL_PLANNING_DEFAULT_APPROVAL_DAYS,
  RAW_MATERIAL_PLANNING_DEFAULT_LOGISTICS_MARGIN_DAYS,
  RAW_MATERIAL_PLANNING_DEFAULT_STOCK_RECENT_DAYS,
  RAW_MATERIAL_PLANNING_DEFAULT_STOCK_STALE_DAYS,
  type RawMaterialDemandEvent,
  type RawMaterialInboundEvent,
  type RawMaterialPlanningConfidence,
  type RawMaterialPlanningHorizon,
  type RawMaterialPlanningStatus,
  type RawMaterialTimelineEvent,
} from "./rawMaterialPlanning.shared.js";

const PRODUCT_PREP_CONCURRENCY = 8;
const LEAD_TIME_SAMPLE_SIZE = 5;

/** Pedidos de compra que representam compromisso operacional real (RASCUNHO ainda não conta). */
const CONFIRMED_PURCHASE_ORDER_STATUSES = [
  "APROVADO",
  "ENVIADO",
  "EMITIDO",
  "CONFIRMADO",
  "PARCIALMENTE_RECEBIDO",
] as const;

export type RawMaterialPlanningFilters = {
  companyIssuer?: string | null;
  customerId?: string | null;
  productId?: string | null;
  materialId?: string | null;
  materialSearch?: string | null;
  supplier?: string | null;
  situations?: RawMaterialPlanningStatus[];
  onlyWithPurchaseNeed?: boolean;
  horizon: RawMaterialPlanningHorizon;
  customHorizonEndDate?: string | null;
  asOfDate?: string | null;
};

export type RawMaterialPlanningConsumingOrderRow = {
  salesOrderId: string;
  orderCode: string | null;
  customerId: string | null;
  customerName: string | null;
  productId: string;
  productSku: string | null;
  productName: string;
  productQuantity: number;
  openQuantity: number;
  deliveryDate: string | null;
  needByDate: string | null;
  needByDateSource: "expectedDeliveryDate" | "none";
  materialQuantity: number;
  unit: string;
};

export type RawMaterialPlanningInboundRow = {
  purchaseOrderId: string;
  purchaseOrderCode: string | null;
  supplierId: string | null;
  quantity: number;
  unit: string;
  expectedDeliveryDate: string | null;
  status: string;
  arrivesBeforeRisk: boolean | null;
  unitMismatch: boolean;
};

export type RawMaterialPlanningRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string;
  countedBalance: number;
  lastStockConferenceAt: string | null;
  stockCountAgeDays: number | null;
  minimumQuantity: number | null;
  contingencyQuantity: number | null;
  protectionTotal: number;
  demandInHorizon: number;
  confirmedInboundInHorizon: number;
  lowestProjectedBalance: number;
  lowestProjectedBalanceDate: string | null;
  firstRiskDate: string | null;
  buyByDate: string | null;
  buyByBlockedReason: "NO_RISK" | "NO_LEAD_TIME" | null;
  technicalNeed: number;
  suggestedQuantity: number;
  lotAdjustment: number;
  adjustmentNote: string | null;
  leadTimeDays: number | null;
  leadTimeSampleCount: number;
  supplier: string | null;
  estimatedUnitCost: number | null;
  estimatedPurchaseValue: number | null;
  situation: RawMaterialPlanningStatus;
  confidence: RawMaterialPlanningConfidence;
  confidenceReasons: string[];
  alerts: string[];
  timeline: ReturnType<typeof projectRawMaterialBalance>["timeline"];
  consumingOrders: RawMaterialPlanningConsumingOrderRow[];
  confirmedInbound: RawMaterialPlanningInboundRow[];
};

export type RawMaterialPlanningSummary = {
  buyNowCount: number;
  buyWithin7DaysCount: number;
  materialsAtRiskCount: number;
  ordersAtRiskCount: number;
  estimatedPurchaseValue: number | null;
  estimatedPurchaseValueIsPartial: boolean;
  staleStockCountMaterials: number;
  missingLeadTimeMaterials: number;
  unitConversionErrorMaterials: number;
  totalMaterials: number;
};

export type RawMaterialPlanningDataQuality = {
  ordersWithoutNeedDate: number;
  itemsWithoutFulfillmentStatus: number;
  purchaseOrdersWithoutExpectedDate: number;
};

export type RawMaterialPlanningPayload = {
  appliedFilters: RawMaterialPlanningFilters;
  asOfDate: string;
  horizon: RawMaterialPlanningHorizon;
  horizonEndDate: string;
  generatedAt: string;
  summary: RawMaterialPlanningSummary;
  materials: RawMaterialPlanningRow[];
  dataQuality: RawMaterialPlanningDataQuality;
  warnings: string[];
};

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safeNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Quantidade ainda em aberto do item — nunca a quantidade cheia quando há
 * evidência de atendimento/corte/cancelamento. `usedFallback=true` sinaliza
 * que o pedido nunca teve status de atendimento resolvido pelo sync Nomus
 * (nomusQuantityPending null) — nesse caso usa a quantidade cheia como
 * aproximação conservadora e isso entra na qualidade de dados.
 */
function resolveOpenItemQuantity(item: {
  quantity: Prisma.Decimal;
  nomusQuantityPending: Prisma.Decimal | null;
  nomusIsCut: boolean;
  nomusIsCanceled: boolean;
}): { quantity: number; usedFallback: boolean } {
  if (item.nomusIsCanceled) return { quantity: 0, usedFallback: false };
  if (item.nomusIsCut) return { quantity: 0, usedFallback: false };
  if (item.nomusQuantityPending != null) {
    return { quantity: Math.max(0, safeNum(item.nomusQuantityPending)), usedFallback: false };
  }
  return { quantity: Math.max(0, safeNum(item.quantity)), usedFallback: true };
}

async function resolveStaleDaysConfig(
  prisma: PrismaClient
): Promise<{ recentDays: number; staleDays: number }> {
  const rows = await prisma.indirectCost.findMany({
    where: {
      category: "GLOBAL_PARAM",
      description: { in: ["MATERIAL_PLANNING_STALE_DAYS", "MATERIAL_PLANNING_ATTENTION_DAYS"] },
    },
  });
  const stale = rows.find((r) => r.description === "MATERIAL_PLANNING_STALE_DAYS");
  const attention = rows.find((r) => r.description === "MATERIAL_PLANNING_ATTENTION_DAYS");
  const staleDays = stale ? safeNum(stale.monthlyValue) : RAW_MATERIAL_PLANNING_DEFAULT_STOCK_STALE_DAYS;
  const recentDays = attention
    ? safeNum(attention.monthlyValue)
    : RAW_MATERIAL_PLANNING_DEFAULT_STOCK_RECENT_DAYS;
  return {
    staleDays: staleDays > 0 ? staleDays : RAW_MATERIAL_PLANNING_DEFAULT_STOCK_STALE_DAYS,
    recentDays: recentDays > 0 ? recentDays : RAW_MATERIAL_PLANNING_DEFAULT_STOCK_RECENT_DAYS,
  };
}

export async function buildRawMaterialPlanningPayload(
  prisma: PrismaClient,
  costEngine: ProductCostAnalysisEngine,
  filters: RawMaterialPlanningFilters,
  now: Date
): Promise<RawMaterialPlanningPayload> {
  const asOfDate = filters.asOfDate?.trim() || formatYmd(now);
  const horizonEndDate = resolveRawMaterialPlanningHorizonEndDate(
    asOfDate,
    filters.horizon,
    filters.customHorizonEndDate
  );

  const mdFilters: MaterialDemandFilters = {
    dateBasis: "expectedDeliveryDate",
    startDate: asOfDate,
    endDate: horizonEndDate,
    includeOrdersWithoutDeliveryDate: true,
    statuses: [],
    status: "",
    customerId: filters.customerId ?? "",
    productId: filters.productId ?? "",
    materialId: filters.materialId ?? "",
    companyIssuer: filters.companyIssuer ?? "",
    unitKey: "",
    search: "",
    mode: "quantity",
    invoicingScope: "all",
    seller: "",
  };

  const where = buildMaterialDemandSalesOrderWhere(mdFilters);

  const salesOrders = await prisma.salesOrder.findMany({
    where: where as Prisma.SalesOrderWhereInput,
    select: {
      id: true,
      orderCode: true,
      companyIssuer: true,
      customerId: true,
      expectedDeliveryDate: true,
      Customer: { select: { id: true, companyName: true } },
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unit: true,
          nomusQuantityPending: true,
          nomusIsCut: true,
          nomusIsCanceled: true,
          Product: { select: { id: true, sku: true, name: true } },
        },
      },
    },
  });

  const analysisCache = await costEngine.initAnalysisCache();
  const explosionMemo = new Map<string, Map<string, ExplosionRowCore>>();
  const productAnalysisMemo = new Map<string, unknown>();
  const uniqueProductIds = [
    ...new Set(salesOrders.flatMap((o) => o.items.map((i) => i.productId))),
  ];

  type ExplosionResult = Map<string, ExplosionRowCore> | null;
  const explosionByProduct = new Map<string, ExplosionResult>();
  for (let i = 0; i < uniqueProductIds.length; i += PRODUCT_PREP_CONCURRENCY) {
    const batch = uniqueProductIds.slice(i, i + PRODUCT_PREP_CONCURRENCY);
    await Promise.all(
      batch.map(async (productId) => {
        const analysis = productAnalysisMemo.has(productId)
          ? productAnalysisMemo.get(productId)
          : await costEngine.getProductCostAnalysis(productId, analysisCache, false);
        productAnalysisMemo.set(productId, analysis);
        if (!analysis || costEngine.isCostAnalysisFailure(analysis)) {
          explosionByProduct.set(productId, null);
          return;
        }
        const explosion = await buildOpenBookRawMaterialExplosionPerUnit(
          productId,
          analysisCache,
          new Set<string>(),
          explosionMemo,
          {
            prisma,
            getProductCostAnalysis: costEngine.getProductCostAnalysis,
            isCostAnalysisFailure: costEngine.isCostAnalysisFailure,
          }
        );
        explosionByProduct.set(productId, explosion instanceof Map ? explosion : null);
      })
    );
  }

  const demandByMaterial = new Map<string, RawMaterialDemandEvent[]>();
  const consumingOrdersByMaterial = new Map<string, RawMaterialPlanningConsumingOrderRow[]>();
  const materialMeta = new Map<
    string,
    { code: string | null; description: string; unit: string; unitKey: string }
  >();
  let ordersWithoutNeedDate = 0;
  let itemsWithoutFulfillmentStatus = 0;

  for (const order of salesOrders) {
    const need = resolveRawMaterialNeedByDate({
      expectedDeliveryDate: order.expectedDeliveryDate ? formatYmd(order.expectedDeliveryDate) : null,
    });
    if (need.source === "none") ordersWithoutNeedDate += 1;
    // Sem data confiável, considera a necessidade como imediata (postura
    // conservadora — nunca some a demanda silenciosamente); fica marcado em
    // dataQuality/alerts, nunca escondido.
    const effectiveDate = need.date ?? asOfDate;

    for (const item of order.items) {
      const { quantity: openQty, usedFallback } = resolveOpenItemQuantity(item);
      if (usedFallback) itemsWithoutFulfillmentStatus += 1;
      if (openQty <= 0) continue;

      const explosion = explosionByProduct.get(item.productId);
      if (!explosion) continue;

      for (const row of explosion.values()) {
        const materialQty = row.quantity * openQty;
        if (!materialMeta.has(row.materialId)) {
          const unitKey = normalizeMaterialUnitKey(row.unit).unitKey;
          materialMeta.set(row.materialId, {
            code: row.code,
            description: row.description,
            unit: row.unit,
            unitKey,
          });
        }
        const events = demandByMaterial.get(row.materialId) ?? [];
        events.push({
          kind: "demand",
          date: effectiveDate,
          quantity: materialQty,
          salesOrderId: order.id,
          orderCode: order.orderCode,
        });
        demandByMaterial.set(row.materialId, events);

        const orders = consumingOrdersByMaterial.get(row.materialId) ?? [];
        orders.push({
          salesOrderId: order.id,
          orderCode: order.orderCode,
          customerId: order.customerId,
          customerName: order.Customer?.companyName ?? null,
          productId: item.productId,
          productSku: item.Product?.sku ?? null,
          productName: item.Product?.name ?? "Produto",
          productQuantity: safeNum(item.quantity),
          openQuantity: openQty,
          deliveryDate: order.expectedDeliveryDate ? formatYmd(order.expectedDeliveryDate) : null,
          needByDate: need.date,
          needByDateSource: need.source,
          materialQuantity: materialQty,
          unit: row.unit,
        });
        consumingOrdersByMaterial.set(row.materialId, orders);
      }
    }
  }

  const materialIds = [...materialMeta.keys()];
  if (materialIds.length === 0) {
    return {
      appliedFilters: filters,
      asOfDate,
      horizon: filters.horizon,
      horizonEndDate,
      generatedAt: now.toISOString(),
      summary: {
        buyNowCount: 0,
        buyWithin7DaysCount: 0,
        materialsAtRiskCount: 0,
        ordersAtRiskCount: 0,
        estimatedPurchaseValue: null,
        estimatedPurchaseValueIsPartial: false,
        staleStockCountMaterials: 0,
        missingLeadTimeMaterials: 0,
        unitConversionErrorMaterials: 0,
        totalMaterials: 0,
      },
      materials: [],
      dataQuality: { ordersWithoutNeedDate, itemsWithoutFulfillmentStatus, purchaseOrdersWithoutExpectedDate: 0 },
      warnings: salesOrders.length === 0 ? ["Nenhum pedido de venda ativo encontrado para os filtros informados."] : [],
    };
  }

  const materials = await prisma.material.findMany({
    where: { id: { in: materialIds } },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      supplier: true,
      currentCost: true,
      quantity: true,
      minimumQuantity: true,
      contingencyQuantity: true,
      lastStockConferenceAt: true,
      isPlanningMonitored: true,
    },
  });
  const materialById = new Map(materials.map((m) => [m.id, m]));

  // Exclui materiais que o usuário marcou como não monitorados no cadastro,
  // antes da computação pesada de projeção/timeline.
  for (const [mid, mat] of materialById) {
    if (mat.isPlanningMonitored === false) {
      materialById.delete(mid);
      demandByMaterial.delete(mid);
      consumingOrdersByMaterial.delete(mid);
      materialMeta.delete(mid);
    }
  }

  // Recalcula a lista efetiva após exclusão dos não-monitorados.
  const monitoredMaterialIds = [...materialMeta.keys()];
  if (monitoredMaterialIds.length === 0) {
    return {
      appliedFilters: filters,
      asOfDate,
      horizon: filters.horizon,
      horizonEndDate,
      generatedAt: now.toISOString(),
      summary: {
        buyNowCount: 0,
        buyWithin7DaysCount: 0,
        materialsAtRiskCount: 0,
        ordersAtRiskCount: 0,
        estimatedPurchaseValue: null,
        estimatedPurchaseValueIsPartial: false,
        staleStockCountMaterials: 0,
        missingLeadTimeMaterials: 0,
        unitConversionErrorMaterials: 0,
        totalMaterials: 0,
      },
      materials: [],
      dataQuality: { ordersWithoutNeedDate, itemsWithoutFulfillmentStatus, purchaseOrdersWithoutExpectedDate: 0 },
      warnings: [],
    };
  }

  const purchaseOrderItems = await prisma.purchaseOrderItem.findMany({
    where: { materialId: { in: monitoredMaterialIds } },
    select: {
      materialId: true,
      quantityOrdered: true,
      unit: true,
      leadTimeDaysSnapshot: true,
      purchaseOrder: {
        select: { id: true, code: true, status: true, supplierId: true, expectedDeliveryDate: true },
      },
      receiptItems: { select: { quantityAccepted: true } },
    },
  });

  const { staleDays, recentDays } = await resolveStaleDaysConfig(prisma);

  let purchaseOrdersWithoutExpectedDate = 0;
  const inboundByMaterial = new Map<string, RawMaterialPlanningInboundRow[]>();
  const leadTimeSamplesByMaterial = new Map<string, number[]>();

  for (const poi of purchaseOrderItems) {
    if (poi.materialId == null) continue;
    if (poi.leadTimeDaysSnapshot != null) {
      const samples = leadTimeSamplesByMaterial.get(poi.materialId) ?? [];
      samples.push(poi.leadTimeDaysSnapshot);
      leadTimeSamplesByMaterial.set(poi.materialId, samples);
    }

    const isConfirmed = (CONFIRMED_PURCHASE_ORDER_STATUSES as readonly string[]).includes(
      poi.purchaseOrder.status
    );
    if (!isConfirmed) continue;

    const received = poi.receiptItems.reduce((sum, r) => sum + safeNum(r.quantityAccepted), 0);
    const pending = safeNum(poi.quantityOrdered) - received;
    if (pending <= 0.000001) continue;

    if (!poi.purchaseOrder.expectedDeliveryDate) {
      purchaseOrdersWithoutExpectedDate += 1;
      continue;
    }

    const materialUnitKey = materialMeta.get(poi.materialId)?.unitKey;
    const itemUnitKey = normalizeMaterialUnitKey(poi.unit).unitKey;
    const unitMismatch = materialUnitKey != null && itemUnitKey !== materialUnitKey;

    const rows = inboundByMaterial.get(poi.materialId) ?? [];
    rows.push({
      purchaseOrderId: poi.purchaseOrder.id,
      purchaseOrderCode: poi.purchaseOrder.code,
      supplierId: poi.purchaseOrder.supplierId,
      quantity: pending,
      unit: poi.unit,
      expectedDeliveryDate: formatYmd(poi.purchaseOrder.expectedDeliveryDate),
      status: poi.purchaseOrder.status,
      arrivesBeforeRisk: null,
      unitMismatch,
    });
    inboundByMaterial.set(poi.materialId, rows);
  }

  const rows: RawMaterialPlanningRow[] = [];
  let buyNowCount = 0;
  let buyWithin7DaysCount = 0;
  let materialsAtRiskCount = 0;
  const ordersAtRisk = new Set<string>();
  let estimatedPurchaseValue = 0;
  let estimatedPurchaseValueIsPartial = false;
  let staleStockCountMaterials = 0;
  let missingLeadTimeMaterials = 0;
  let unitConversionErrorMaterials = 0;

  for (const materialId of monitoredMaterialIds) {
    const material = materialById.get(materialId);
    const meta = materialMeta.get(materialId)!;
    if (!material) continue;

    const demandEvents = demandByMaterial.get(materialId) ?? [];
    const inboundRowsRaw = inboundByMaterial.get(materialId) ?? [];
    const unitConversionError = inboundRowsRaw.some((r) => r.unitMismatch);
    const validInbound = inboundRowsRaw.filter((r) => !r.unitMismatch);

    const timelineEvents: RawMaterialTimelineEvent[] = [
      ...demandEvents,
      ...validInbound.map(
        (r): RawMaterialInboundEvent => ({
          kind: "inbound",
          date: r.expectedDeliveryDate!,
          quantity: r.quantity,
          purchaseOrderId: r.purchaseOrderId,
          purchaseOrderCode: r.purchaseOrderCode,
          status: r.status,
        })
      ),
    ];

    const countedBalance = safeNum(material.quantity);
    const minimumQuantity = material.minimumQuantity != null ? safeNum(material.minimumQuantity) : null;
    const contingencyQuantity =
      material.contingencyQuantity != null ? safeNum(material.contingencyQuantity) : null;

    const projection = projectRawMaterialBalance({
      countedBalance,
      minimumQuantity,
      contingencyQuantity,
      events: timelineEvents,
      asOfDate,
      horizonEndDate,
    });

    const stockCountAgeDays = resolveStockCountAgeDays(
      material.lastStockConferenceAt ? material.lastStockConferenceAt.toISOString() : null,
      asOfDate
    );

    const leadTimeSamples = (leadTimeSamplesByMaterial.get(materialId) ?? [])
      .slice(-LEAD_TIME_SAMPLE_SIZE);
    const leadTimeDays =
      leadTimeSamples.length > 0
        ? Math.round(leadTimeSamples.reduce((s, v) => s + v, 0) / leadTimeSamples.length)
        : null;

    const buyBy = calculateBuyByDate({
      firstRiskDate: projection.firstRiskDate,
      leadTimeDays,
      approvalDays: RAW_MATERIAL_PLANNING_DEFAULT_APPROVAL_DAYS,
      logisticsMarginDays: RAW_MATERIAL_PLANNING_DEFAULT_LOGISTICS_MARGIN_DAYS,
    });

    const technicalNeed = Math.max(0, projection.protectionTotal - projection.lowestProjectedBalance);
    const recommendation = calculatePurchaseRecommendation({
      technicalNeed,
      minPurchaseLot: null,
      purchaseMultiple: null,
    });

    const hasConfirmedInbound = validInbound.length > 0;
    let inboundArrivesBeforeRisk: boolean | null = null;
    if (hasConfirmedInbound && projection.firstRiskDate) {
      inboundArrivesBeforeRisk = validInbound.every(
        (r) => r.expectedDeliveryDate! <= projection.firstRiskDate!
      );
    }
    const finalInboundRows = inboundRowsRaw.map((r) => ({
      ...r,
      arrivesBeforeRisk:
        r.unitMismatch || !projection.firstRiskDate
          ? null
          : (r.expectedDeliveryDate ?? "") <= projection.firstRiskDate,
    }));

    const situation = classifyRawMaterialPlanningStatus({
      asOfDate,
      firstRiskDate: projection.firstRiskDate,
      buyByDate: buyBy.buyByDate,
      buyByBlockedReason: buyBy.blockedReason,
      hasConfirmedInbound,
      inboundArrivesBeforeRisk,
      technicalNeed,
      unitConversionError,
      stockCountAgeDays,
      stockCountStaleDaysThreshold: staleDays,
    });

    const consumingOrders = consumingOrdersByMaterial.get(materialId) ?? [];
    const hasOrdersWithoutNeedDate = consumingOrders.some((o) => o.needByDateSource === "none");

    const confidence = calculatePlanningConfidence({
      stockCountAgeDays,
      stockCountRecentDaysThreshold: recentDays,
      stockCountStaleDaysThreshold: staleDays,
      hasLeadTime: leadTimeDays != null,
      hasUnresolvedBomOrAnalysisIssue: false,
      unitConversionError,
      hasOrdersWithoutNeedDate,
      inboundUnconfirmed: false,
    });

    const alerts: string[] = [];
    if (situation === "STOCK_COUNT_STALE") {
      alerts.push(`Última contagem há ${stockCountAgeDays} dias (limite: ${staleDays}).`);
    }
    if (situation === "DATA_INCOMPLETE") alerts.push("Lead time não cadastrado — sem histórico de compras deste material.");
    if (unitConversionError) alerts.push("Entrada de compra com unidade diferente da cadastrada — não somada à cobertura.");
    if (hasOrdersWithoutNeedDate) alerts.push("Existem pedidos sem data de entrega prevista — necessidade tratada como imediata (conservador).");
    if (inboundRowsRaw.some((r) => !r.expectedDeliveryDate)) alerts.push("Existem pedidos de compra confirmados sem data prevista de entrega — não considerados na projeção.");

    if (projection.firstRiskDate) {
      materialsAtRiskCount += 1;
      for (const o of consumingOrders) ordersAtRisk.add(o.salesOrderId);
    }
    if (situation === "BUY_NOW") buyNowCount += 1;
    if (situation === "BUY_WITHIN_7_DAYS") buyWithin7DaysCount += 1;
    if (situation === "STOCK_COUNT_STALE") staleStockCountMaterials += 1;
    if (leadTimeDays == null) missingLeadTimeMaterials += 1;
    if (unitConversionError) unitConversionErrorMaterials += 1;

    const unitCost = safeNum(material.currentCost);
    const estimatedUnitCost = unitCost > 0 ? unitCost : null;
    const estimatedPurchaseValueForMaterial =
      estimatedUnitCost != null ? estimatedUnitCost * recommendation.suggestedQuantity : null;
    if (estimatedPurchaseValueForMaterial != null) {
      estimatedPurchaseValue += estimatedPurchaseValueForMaterial;
    } else if (recommendation.suggestedQuantity > 0) {
      estimatedPurchaseValueIsPartial = true;
    }

    rows.push({
      materialId,
      code: material.code,
      description: material.description,
      unit: meta.unit,
      countedBalance,
      lastStockConferenceAt: material.lastStockConferenceAt
        ? material.lastStockConferenceAt.toISOString()
        : null,
      stockCountAgeDays,
      minimumQuantity,
      contingencyQuantity,
      protectionTotal: projection.protectionTotal,
      demandInHorizon: demandEvents.reduce((s, e) => s + e.quantity, 0),
      confirmedInboundInHorizon: validInbound.reduce((s, e) => s + e.quantity, 0),
      lowestProjectedBalance: projection.lowestProjectedBalance,
      lowestProjectedBalanceDate: projection.lowestProjectedBalanceDate,
      firstRiskDate: projection.firstRiskDate,
      buyByDate: buyBy.buyByDate,
      buyByBlockedReason: buyBy.blockedReason,
      technicalNeed: recommendation.technicalNeed,
      suggestedQuantity: recommendation.suggestedQuantity,
      lotAdjustment: recommendation.lotAdjustment,
      adjustmentNote: recommendation.adjustmentNote,
      leadTimeDays,
      leadTimeSampleCount: leadTimeSamples.length,
      supplier: material.supplier,
      estimatedUnitCost,
      estimatedPurchaseValue: estimatedPurchaseValueForMaterial,
      situation,
      confidence: confidence.level,
      confidenceReasons: confidence.reasons,
      alerts,
      timeline: projection.timeline,
      consumingOrders,
      confirmedInbound: finalInboundRows,
    });
  }

  const filteredRows = rows.filter((row) => {
    if (filters.situations && filters.situations.length > 0 && !filters.situations.includes(row.situation)) {
      return false;
    }
    if (filters.onlyWithPurchaseNeed && row.suggestedQuantity <= 0) return false;
    if (filters.materialSearch) {
      const q = filters.materialSearch.trim().toLowerCase();
      const hay = `${row.code ?? ""} ${row.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.supplier) {
      const q = filters.supplier.trim().toLowerCase();
      if (!(row.supplier ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  filteredRows.sort((a, b) => {
    const aDate = a.buyByDate ?? "9999-99-99";
    const bDate = b.buyByDate ?? "9999-99-99";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return (a.code ?? "").localeCompare(b.code ?? "", "pt-BR");
  });

  const warnings: string[] = [];
  if (purchaseOrdersWithoutExpectedDate > 0) {
    warnings.push(
      `${purchaseOrdersWithoutExpectedDate} pedido(s) de compra confirmados sem data prevista de entrega não entraram na projeção.`
    );
  }
  if (ordersWithoutNeedDate > 0) {
    warnings.push(`${ordersWithoutNeedDate} pedido(s) de venda sem data de entrega prevista.`);
  }
  if (itemsWithoutFulfillmentStatus > 0) {
    warnings.push(
      `${itemsWithoutFulfillmentStatus} item(ns) de pedido sem status de atendimento Nomus resolvido — quantidade cheia usada como aproximação.`
    );
  }

  return {
    appliedFilters: filters,
    asOfDate,
    horizon: filters.horizon,
    horizonEndDate,
    generatedAt: now.toISOString(),
    summary: {
      buyNowCount,
      buyWithin7DaysCount,
      materialsAtRiskCount,
      ordersAtRiskCount: ordersAtRisk.size,
      estimatedPurchaseValue: estimatedPurchaseValue > 0 || !estimatedPurchaseValueIsPartial ? estimatedPurchaseValue : null,
      estimatedPurchaseValueIsPartial,
      staleStockCountMaterials,
      missingLeadTimeMaterials,
      unitConversionErrorMaterials,
      totalMaterials: rows.length,
    },
    materials: filteredRows,
    dataQuality: { ordersWithoutNeedDate, itemsWithoutFulfillmentStatus, purchaseOrdersWithoutExpectedDate },
    warnings,
  };
}
