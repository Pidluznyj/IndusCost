/**
 * Custos industriais + MP + resultado para o Detalhe do Pedido (server-only).
 */
import type { PrismaClient } from "@prisma/client";
import { normalizeProductionCostBomLineAudit } from "@/src/lib/productionCostCalculationSnapshotAudit.js";
import {
  effectiveProductionCostLookupKey,
  type EffectiveProductProductionCostOk,
} from "@/src/lib/productionCostVersioning.js";
import { getEffectiveProductProductionCostsForPairs } from "@/src/lib/productionCostTables.server.js";
import {
  resolveSalesOrderItemProducts,
  type SalesOrderMarginResolverItem,
} from "@/src/lib/salesOrderMarginResolver.js";
import { loadSalesOrderMarginProductBatchIndex } from "@/src/lib/salesOrderMarginResolver.server.js";
import {
  loadSalesOrderItemsForMargin,
  type SalesOrderForMargin,
  type SalesOrderItemForMargin,
} from "@/src/lib/salesOrderMarginService.server.js";
import {
  extractNomusRawItems,
  matchRawItemToDbItem,
  resolveSalesOrderItemNomusStatus,
} from "@/src/lib/salesOrderNomusRaw.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { loadSalesOrderIndustrialResultReportPayload } from "@/src/lib/sales/salesOrderIndustrialResultReportService.server.js";
import {
  buildSalesOrderDetailIndustrialResultBlock,
  scaleBomMaterialLineForOrderItem,
  type SalesOrderDetailIndustrialMaterialLine,
  type SalesOrderDetailIndustrialResultBlock,
} from "./salesOrderDetailIndustrialResult.js";

function qtyNumber(value: unknown): number {
  const n = decimalToNumber(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function mapItemToResolverInput(
  item: SalesOrderItemForMargin,
  order: SalesOrderForMargin,
  itemIndex: number,
  totalItems: number
): SalesOrderMarginResolverItem {
  const dbItem = {
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
  };
  const matchOptions = { itemIndex, totalDbItems: totalItems };
  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  const matched = matchRawItemToDbItem(rawItems, dbItem, matchOptions);
  const nomusStatus = resolveSalesOrderItemNomusStatus(
    order.nomusRawResponse,
    dbItem,
    matchOptions
  );
  const persistedCanceled =
    item.nomusIsCanceled === true ||
    item.nomusIsStale === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED" ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELADO";
  const persistedCut =
    item.nomusIsCut === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "FULFILLED_WITH_CUT";
  const isCanceled = persistedCanceled || persistedCut || nomusStatus === "cancelled";

  return {
    salesOrderItemId: item.id,
    productId: item.productId,
    externalProductId: item.externalProductId,
    skuSnapshot: item.skuSnapshot,
    productNameSnapshot: item.productNameSnapshot,
    quantity: item.quantity,
    negotiatedPrice: item.negotiatedPrice,
    totalNetValue: item.totalNetValue,
    unitCost: item.unitCost,
    itemStatus: isCanceled
      ? "CANCELADO"
      : item.nomusItemStatusNormalized ?? matched?.status ?? null,
    isCanceled,
    nomusRawItem: matched?.raw ?? null,
    referenceDate: order.issueDate ?? null,
  };
}

function readBomLinesFromSnapshot(snapshot: unknown): ReturnType<
  typeof normalizeProductionCostBomLineAudit
>[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const raw = snapshot as Record<string, unknown>;
  const bom = raw.bomStructure;
  if (bom && typeof bom === "object") {
    const lines = (bom as { lines?: unknown }).lines;
    if (Array.isArray(lines)) {
      return lines.map(normalizeProductionCostBomLineAudit);
    }
  }
  return [];
}

async function loadMaterialLinesForOrder(
  prisma: PrismaClient,
  salesOrderId: string
): Promise<{ lines: SalesOrderDetailIndustrialMaterialLine[]; warnings: string[] }> {
  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      id: true,
      proposalId: true,
      issueDate: true,
      nomusRawResponse: true,
    },
  });
  if (!order) return { lines: [], warnings: ["Pedido não encontrado para explosão de MP."] };

  const itemsByOrderId = await loadSalesOrderItemsForMargin(prisma, [salesOrderId]);
  const items = itemsByOrderId.get(salesOrderId) ?? [];
  const resolverItems = items.map((item, index) =>
    mapItemToResolverInput(
      item,
      {
        id: order.id,
        proposalId: order.proposalId,
        issueDate: order.issueDate,
        nomusRawResponse: order.nomusRawResponse,
        items,
      },
      index,
      items.length
    )
  );
  const productIndex = await loadSalesOrderMarginProductBatchIndex(prisma, resolverItems);
  const productResolutions = resolveSalesOrderItemProducts(resolverItems, productIndex);

  const pairs: Array<{ productId: string; referenceDate: Date }> = [];
  for (const mapped of resolverItems) {
    if (mapped.isCanceled) continue;
    const productId = productResolutions.get(mapped.salesOrderItemId)?.productId;
    if (!productId || !order.issueDate) continue;
    pairs.push({ productId, referenceDate: order.issueDate });
  }
  const effectiveCostsByKey = await getEffectiveProductProductionCostsForPairs(prisma, pairs);

  const lines: SalesOrderDetailIndustrialMaterialLine[] = [];
  const warnings: string[] = [];

  for (const mapped of resolverItems) {
    if (mapped.isCanceled) continue;
    const productId = productResolutions.get(mapped.salesOrderItemId)?.productId;
    const qty = qtyNumber(mapped.quantity);
    if (!productId || !order.issueDate || !(qty > 0)) continue;
    const key = effectiveProductionCostLookupKey(productId, order.issueDate);
    const effective = effectiveCostsByKey.get(key);
    if (!effective || effective.status !== "OK") {
      warnings.push(
        `Item ${mapped.skuSnapshot ?? mapped.salesOrderItemId}: sem snapshot de custo para listar MP.`
      );
      continue;
    }
    const ok = effective as EffectiveProductProductionCostOk;
    const bomLines = readBomLinesFromSnapshot(ok.calculationSnapshot);
    if (bomLines.length === 0) {
      warnings.push(
        `Item ${mapped.skuSnapshot ?? productId}: snapshot publicado sem linhas de BOM/MP.`
      );
      continue;
    }
    for (const bom of bomLines) {
      const scaled = scaleBomMaterialLineForOrderItem({
        line: bom,
        orderItemQuantity: qty,
        sourceProductSku: mapped.skuSnapshot,
        sourceProductName: mapped.productNameSnapshot,
      });
      if (scaled) lines.push(scaled);
    }
  }

  return { lines, warnings };
}

export async function loadSalesOrderDetailIndustrialResult(
  prisma: PrismaClient,
  salesOrderId: string
): Promise<SalesOrderDetailIndustrialResultBlock> {
  const id = salesOrderId.trim();
  if (!id) {
    return buildSalesOrderDetailIndustrialResultBlock({
      row: null,
      materials: [],
      extraWarnings: ["salesOrderId inválido."],
    });
  }

  const [report, materialPack] = await Promise.all([
    loadSalesOrderIndustrialResultReportPayload(prisma, {
      query: {},
      salesOrderIds: [id],
      emitterName: null,
    }),
    loadMaterialLinesForOrder(prisma, id),
  ]);

  const row = report.rows.find((r) => r.salesOrderId === id) ?? report.rows[0] ?? null;
  return buildSalesOrderDetailIndustrialResultBlock({
    row,
    materials: materialPack.lines,
    extraWarnings: materialPack.warnings,
  });
}
