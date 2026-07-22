/**
 * Serviço de indicadores executivos SC (OP-26) — somente leitura.
 * Não muta BOM/OP/custo/AP/Nomus.
 */
import type { PrismaClient } from "@prisma/client";
import { computeQuantityPending } from "./purchaseReceiptWorkflow.js";
import { computeSavingsComparison } from "./realizedSavingsEngine.js";
import {
  buildSupplyChainIndicatorCards,
  offerInitialComparable,
  type InventoryBalanceAgg,
  type PipelineMoneySnapshot,
  type SupplyChainIndicatorsFilters,
} from "./supplyChainIndicatorsEngine.js";
import { explodeMaterialDemand } from "./shadowPurchasePlanningEngine.js";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toYmd(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function todayYmd(now = new Date()): string {
  return toYmd(now)!;
}

function pipelineKeyOf(input: {
  purchaseRequestId?: string | null;
  quotationId?: string | null;
  purchaseOrderId?: string | null;
}): string {
  return (
    input.purchaseRequestId ||
    input.quotationId ||
    input.purchaseOrderId ||
    "unknown"
  );
}

export async function buildSupplyChainIndicators(
  prisma: PrismaClient,
  filters: SupplyChainIndicatorsFilters = {},
  now = new Date()
) {
  const [
    requests,
    quotations,
    awards,
    orders,
    balances,
    receiptsDivergent,
    ops,
  ] = await Promise.all([
    prisma.purchaseRequest.findMany({
      select: {
        id: true,
        createdAt: true,
        items: { select: { materialId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 800,
    }),
    prisma.purchaseQuotation.findMany({
      where: { status: { not: "CANCELADA" } },
      select: {
        id: true,
        purchaseRequestId: true,
        createdAt: true,
        items: { select: { materialId: true } },
        offers: {
          where: { status: { in: ["RECEBIDA", "VENCEDORA"] } },
          select: {
            id: true,
            status: true,
            initialFreightValue: true,
            initialNonRecoverableTaxes: true,
            initialExpenses: true,
            initialDiscounts: true,
            quotationSupplier: { select: { supplierId: true } },
            items: {
              select: {
                initialUnitPrice: true,
                initialQuantity: true,
                quotationItem: { select: { quantity: true, materialId: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.purchaseQuotationAward.findMany({
      where: { status: { in: ["PENDENTE_APROVACAO", "APROVADA"] } },
      select: {
        id: true,
        quotationId: true,
        status: true,
        createdAt: true,
        initialComparableTotal: true,
        awardedComparableTotal: true,
        totalGain: true,
        usedEvidenceException: true,
        evidenceCountSnapshot: true,
        quotation: {
          select: {
            purchaseRequestId: true,
            items: { select: { materialId: true } },
          },
        },
        allocations: {
          select: { supplierId: true },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { notIn: ["CANCELADO", "ENCERRADO"] } },
      select: {
        id: true,
        code: true,
        status: true,
        purchaseRequestId: true,
        quotationId: true,
        awardId: true,
        supplierId: true,
        createdAt: true,
        expectedDeliveryDate: true,
        currency: true,
        deliveryTermsSnapshot: true,
        freightValueSnapshot: true,
        nonRecoverableTaxesSnapshot: true,
        discountsSnapshot: true,
        initialComparableTotalSnapshot: true,
        negotiatedComparableTotalSnapshot: true,
        totalGainSnapshot: true,
        items: {
          select: {
            id: true,
            materialId: true,
            quantityOrdered: true,
            description: true,
            initialUnitPriceSnapshot: true,
            unitPriceSnapshot: true,
            freightValueSnapshot: true,
            nonRecoverableTaxesSnapshot: true,
            discountsSnapshot: true,
            receiptItems: {
              where: { receipt: { status: "APROVADO" } },
              select: {
                quantityAccepted: true,
                effectiveUnitCost: true,
                unitCostSnapshot: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.inventoryBalance.findMany({
      select: {
        itemId: true,
        warehouseId: true,
        physicalQuantity: true,
        reservedQuantity: true,
        blockedQuantity: true,
        quarantineQuantity: true,
        availableQuantity: true,
        item: {
          select: {
            id: true,
            materialId: true,
            status: true,
            minimumStock: true,
            controlsStock: true,
          },
        },
      },
    }),
    prisma.purchaseReceipt.findMany({
      where: { status: "DIVERGENTE" },
      select: {
        id: true,
        status: true,
        purchaseOrderId: true,
        createdAt: true,
        purchaseOrder: { select: { supplierId: true } },
        items: { select: { materialId: true } },
      },
      take: 300,
    }),
    prisma.nomusProductionOrder.findMany({
      where: { closedAt: null },
      select: {
        id: true,
        productCode: true,
        quantity: true,
        plannedAt: true,
        deliveryAt: true,
        status: true,
      },
      take: 400,
    }),
  ]);

  // Demanda futura por material (explosão BOM leve — read-only) para cobertura estimada.
  const reads = createOfficialDataProviders(prisma);
  const horizonDays = 90;
  const from = todayYmd(now);
  const demandByMaterial = new Map<string, number>();
  const bomCache = new Map<string, Awaited<ReturnType<typeof reads.productsBom.listBomByProductId>>>();
  const productCache = new Map<string, string | null>();

  for (const op of ops) {
    if (op.status && /cancel|encerr|fechad|conclu/i.test(op.status)) continue;
    const dateYmd = toYmd(op.plannedAt) ?? toYmd(op.deliveryAt);
    if (dateYmd && (dateYmd < from || dateYmd > toYmd(new Date(now.getTime() + horizonDays * 86400000))!)) {
      continue;
    }
    const sku = op.productCode?.trim();
    const qty = num(op.quantity);
    if (!sku || qty <= 0) continue;
    let productId = productCache.get(sku);
    if (productId === undefined) {
      const p = await reads.productsBom.findProductBySku(sku);
      productId = p?.id ?? null;
      productCache.set(sku, productId);
    }
    if (!productId) continue;
    let bom = bomCache.get(productId);
    if (!bom) {
      bom = await reads.productsBom.listBomByProductId(productId);
      bomCache.set(productId, bom);
    }
    for (const line of bom) {
      if (!line.materialId) continue;
      const md = explodeMaterialDemand({
        productQty: qty,
        bomQuantityPerProduct: num(line.quantity),
      });
      demandByMaterial.set(
        line.materialId,
        (demandByMaterial.get(line.materialId) ?? 0) + md
      );
    }
  }

  // Pipelines money
  const pipelineMap = new Map<string, PipelineMoneySnapshot>();

  function ensurePipeline(key: string, createdAt: Date, extras?: Partial<PipelineMoneySnapshot>) {
    let row = pipelineMap.get(key);
    if (!row) {
      row = {
        pipelineKey: key,
        initialComparable: null,
        quotedBestComparable: null,
        negotiatedComparable: null,
        negotiatedGain: null,
        realizedGain: null,
        createdAt: createdAt.toISOString(),
        supplierId: null,
        materialIds: [],
        ...extras,
      };
      pipelineMap.set(key, row);
    }
    return row;
  }

  for (const req of requests) {
    const key = req.id;
    const row = ensurePipeline(key, req.createdAt);
    for (const it of req.items) {
      if (it.materialId && !row.materialIds.includes(it.materialId)) {
        row.materialIds.push(it.materialId);
      }
    }
  }

  for (const q of quotations) {
    const key = pipelineKeyOf({
      purchaseRequestId: q.purchaseRequestId,
      quotationId: q.id,
    });
    const row = ensurePipeline(key, q.createdAt);
    for (const it of q.items) {
      if (it.materialId && !row.materialIds.includes(it.materialId)) {
        row.materialIds.push(it.materialId);
      }
    }
    let best: number | null = null;
    for (const offer of q.offers) {
      if (offer.quotationSupplier?.supplierId && !row.supplierId) {
        row.supplierId = offer.quotationSupplier.supplierId;
      }
      const lines = offer.items.map((oi) => ({
        unitPrice: num(oi.initialUnitPrice),
        quantity: num(oi.initialQuantity ?? oi.quotationItem.quantity),
      }));
      if (lines.length === 0) continue;
      const comparable = offerInitialComparable({
        lines,
        freight: numOrNull(offer.initialFreightValue),
        taxes: numOrNull(offer.initialNonRecoverableTaxes),
        expenses: numOrNull(offer.initialExpenses),
        discounts: numOrNull(offer.initialDiscounts),
      });
      if (best == null || comparable < best) best = comparable;
    }
    if (best != null) {
      row.quotedBestComparable = best;
      if (row.initialComparable == null) row.initialComparable = best;
    }
  }

  for (const award of awards) {
    const key = pipelineKeyOf({
      purchaseRequestId: award.quotation.purchaseRequestId,
      quotationId: award.quotationId,
    });
    const row = ensurePipeline(key, award.createdAt);
    const initial = numOrNull(award.initialComparableTotal);
    const awarded = numOrNull(award.awardedComparableTotal);
    const gain = numOrNull(award.totalGain);
    if (initial != null) {
      row.initialComparable =
        row.initialComparable == null ? initial : Math.max(row.initialComparable, initial);
    }
    if (awarded != null) {
      if (row.negotiatedComparable == null) row.negotiatedComparable = awarded;
    }
    if (gain != null) {
      row.negotiatedGain =
        row.negotiatedGain == null || Math.abs(gain) > Math.abs(row.negotiatedGain)
          ? gain
          : row.negotiatedGain;
    }
    if (award.allocations[0]?.supplierId) row.supplierId = award.allocations[0].supplierId;
    for (const it of award.quotation.items) {
      if (it.materialId && !row.materialIds.includes(it.materialId)) {
        row.materialIds.push(it.materialId);
      }
    }
  }

  const openOrders: Array<{
    purchaseOrderId: string;
    pipelineKey: string;
    status: string;
    expectedDeliveryDate: string | null;
    quantityPending: number;
    supplierId: string | null;
    materialIds: string[];
    createdAt: string;
  }> = [];
  for (const po of orders) {
    const key = pipelineKeyOf({
      purchaseRequestId: po.purchaseRequestId,
      quotationId: po.quotationId,
      purchaseOrderId: po.id,
    });
    const row = ensurePipeline(key, po.createdAt, { supplierId: po.supplierId });
    row.supplierId = po.supplierId;
    const initial = numOrNull(po.initialComparableTotalSnapshot);
    const negotiated = numOrNull(po.negotiatedComparableTotalSnapshot);
    const gain = numOrNull(po.totalGainSnapshot);
    if (initial != null) row.initialComparable = initial; // PO snapshot vence
    if (negotiated != null) row.negotiatedComparable = negotiated;
    if (gain != null) row.negotiatedGain = gain;

    // Realized gain via OP-24 engine
    const acceptedByItem = new Map<string, { qty: number; costSum: number }>();
    for (const item of po.items) {
      if (item.materialId && !row.materialIds.includes(item.materialId)) {
        row.materialIds.push(item.materialId);
      }
      for (const ri of item.receiptItems) {
        const qty = num(ri.quantityAccepted);
        if (qty <= 0) continue;
        const unit = numOrNull(ri.effectiveUnitCost) ?? numOrNull(ri.unitCostSnapshot) ?? 0;
        const prev = acceptedByItem.get(item.id) ?? { qty: 0, costSum: 0 };
        acceptedByItem.set(item.id, {
          qty: prev.qty + qty,
          costSum: prev.costSum + unit * qty,
        });
      }
    }

    const lines = po.items.map((item) => {
      const acc = acceptedByItem.get(item.id);
      const qtyAccepted = acc?.qty ?? 0;
      const receivedUnitCost =
        qtyAccepted > 0 && acc ? acc.costSum / qtyAccepted : null;
      return {
        purchaseOrderItemId: item.id,
        description: item.description,
        quantityOrdered: num(item.quantityOrdered),
        initialUnitPrice: numOrNull(item.initialUnitPriceSnapshot),
        orderUnitPrice: num(item.unitPriceSnapshot),
        orderFreight: num(item.freightValueSnapshot),
        orderTaxes: num(item.nonRecoverableTaxesSnapshot),
        orderExpenses: 0,
        orderDiscounts: num(item.discountsSnapshot),
        quantityAcceptedConfirmed: qtyAccepted,
        receivedUnitCost,
        receivedFreight: 0,
        receivedTaxes: 0,
        receivedExpenses: 0,
        receivedDiscounts: 0,
      };
    });

    const comparison = computeSavingsComparison({
      currency: po.currency,
      initialComparableTotalSnapshot: initial,
      negotiatedComparableTotalSnapshot: negotiated,
      totalGainSnapshot: gain,
      orderFreightHeader: num(po.freightValueSnapshot),
      orderTaxesHeader: num(po.nonRecoverableTaxesSnapshot),
      orderExpensesHeader: 0,
      orderDiscountsHeader: num(po.discountsSnapshot),
      freightIncoterm: po.deliveryTermsSnapshot,
      evidenceCount: 1,
      lines,
    });
    row.realizedGain = comparison.gains.realizedGain;

    let pending = 0;
    const materialIds: string[] = [];
    for (const item of po.items) {
      const accepted = item.receiptItems.reduce((s, r) => s + num(r.quantityAccepted), 0);
      pending += computeQuantityPending(num(item.quantityOrdered), accepted);
      if (item.materialId) materialIds.push(item.materialId);
    }
    openOrders.push({
      purchaseOrderId: po.id,
      pipelineKey: key,
      status: po.status,
      expectedDeliveryDate: toYmd(po.expectedDeliveryDate),
      quantityPending: pending,
      supplierId: po.supplierId,
      materialIds,
      createdAt: po.createdAt.toISOString(),
    });
  }

  const inventoryBalances: InventoryBalanceAgg[] = [];
  for (const b of balances) {
    if (b.item.status !== "ACTIVE" || !b.item.controlsStock) continue;
    inventoryBalances.push({
      itemId: b.itemId,
      materialId: b.item.materialId,
      warehouseId: b.warehouseId,
      physical: num(b.physicalQuantity),
      reserved: num(b.reservedQuantity),
      blocked: num(b.blockedQuantity),
      quarantine: num(b.quarantineQuantity),
      available: num(b.availableQuantity),
      minimumStock: numOrNull(b.item.minimumStock),
      futureDemand: b.item.materialId
        ? demandByMaterial.get(b.item.materialId) ?? 0
        : 0,
      horizonDays,
    });
  }

  const evidenceExceptions = awards.map((a) => ({
    awardId: a.id,
    pipelineKey: pipelineKeyOf({
      purchaseRequestId: a.quotation.purchaseRequestId,
      quotationId: a.quotationId,
    }),
    usedEvidenceException: a.usedEvidenceException,
    evidenceCountSnapshot: a.evidenceCountSnapshot,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    supplierId: a.allocations[0]?.supplierId ?? null,
    materialIds: a.quotation.items
      .map((i) => i.materialId)
      .filter((id): id is string => !!id),
  }));

  const divergentReceipts = receiptsDivergent.map((r) => ({
    receiptId: r.id,
    status: r.status,
    purchaseOrderId: r.purchaseOrderId,
    supplierId: r.purchaseOrder.supplierId,
    materialIds: r.items.map((i) => i.materialId).filter((id): id is string => !!id),
    createdAt: r.createdAt.toISOString(),
  }));

  const built = buildSupplyChainIndicatorCards({
    filters,
    todayYmd: todayYmd(now),
    pipelines: Array.from(pipelineMap.values()),
    openOrders,
    balances: inventoryBalances,
    evidenceExceptions,
    divergentReceipts,
  });

  return {
    filters,
    generatedAt: now.toISOString(),
    cards: built.cards,
    report: built.report,
    meta: built.meta,
  };
}
