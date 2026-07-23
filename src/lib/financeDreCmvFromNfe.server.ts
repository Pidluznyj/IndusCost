/**
 * CMV do DRE Gerencial — item da NF-e × custo vigente na data da nota.
 * Não depende de vínculo com Pedido de Venda.
 */

import { prisma } from "@/src/lib/prisma.js";
import { queryFiscalNfesForDreCmv } from "@/src/lib/financeDreNfeQueries.server.js";
import { extractDreNfeItemsFromRawPayload } from "@/src/lib/financeDreNfeItemExtract.js";
import {
  getEffectiveProductProductionCostsForPairs,
  type EffectiveProductionCostPair,
} from "@/src/lib/productionCostTables.server.js";
import { effectiveProductionCostLookupKey } from "@/src/lib/productionCostVersioning.js";
import { createEmptyMonthlySeries } from "@/src/lib/financeDreCostCenterRoles.js";
import { emptyDreSeries, roundDreMoney } from "@/src/lib/financeDreMath.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";

export type DreCmvFromNfeResult = {
  cmv: number[];
  /** NF-e sem itens parseáveis (payload/estoque). */
  missingItemsNfeCount: number;
  missingItemsRevenueByMonth: number[];
  /** Itens sem produto local resolvido. */
  missingProductLineCount: number;
  missingProductRevenueByMonth: number[];
  /** Itens com produto mas sem custo vigente. */
  missingCostLineCount: number;
  missingCostRevenueByMonth: number[];
  /** Linhas com CMV calculado. */
  pricedLineCount: number;
};

async function loadStockItemsByNfeExternalId(
  nfeExternalIds: number[]
): Promise<Map<number, Array<{ externalProductId: number | null; quantity: number }>>> {
  const out = new Map<number, Array<{ externalProductId: number | null; quantity: number }>>();
  if (nfeExternalIds.length === 0) return out;

  const docs = await prisma.nomusStockDocument.findMany({
    where: {
      idNfe: { in: nfeExternalIds },
      isCancelled: false,
    },
    select: {
      idNfe: true,
      items: {
        select: {
          externalProductId: true,
          quantity: true,
        },
      },
    },
  });

  for (const doc of docs) {
    if (doc.idNfe == null) continue;
    const list = out.get(doc.idNfe) ?? [];
    for (const item of doc.items) {
      const qty = decimalToNumber(item.quantity) ?? 0;
      if (qty <= 0) continue;
      list.push({
        externalProductId: item.externalProductId ?? null,
        quantity: qty,
      });
    }
    out.set(doc.idNfe, list);
  }
  return out;
}

type ResolvedLine = {
  month: number;
  productId: string;
  quantity: number;
  competenceDate: Date;
  lineRevenue: number;
};

export async function loadMonthlyCmvFromNfeProductCosts(
  year: number,
  emitterCnpjDigits?: string
): Promise<DreCmvFromNfeResult> {
  const nfes = await queryFiscalNfesForDreCmv(year, "emissao", emitterCnpjDigits);
  const empty = (): DreCmvFromNfeResult => ({
    cmv: emptyDreSeries(),
    missingItemsNfeCount: 0,
    missingItemsRevenueByMonth: emptyDreSeries(),
    missingProductLineCount: 0,
    missingProductRevenueByMonth: emptyDreSeries(),
    missingCostLineCount: 0,
    missingCostRevenueByMonth: emptyDreSeries(),
    pricedLineCount: 0,
  });
  if (nfes.length === 0) return empty();

  const nfeRows = await prisma.nomusNfe.findMany({
    where: { id: { in: nfes.map((n) => n.nomusNfeId) } },
    select: {
      id: true,
      externalId: true,
      rawPayload: true,
    },
  });
  const payloadById = new Map(nfeRows.map((row) => [row.id, row.rawPayload]));
  const stockByNfe = await loadStockItemsByNfeExternalId(nfes.map((n) => n.nfeExternalId));

  let missingItemsNfeCount = 0;
  const missingItemsRevenueByMonth = createEmptyMonthlySeries();
  let missingProductLineCount = 0;
  const missingProductRevenueByMonth = createEmptyMonthlySeries();
  let missingCostLineCount = 0;
  const missingCostRevenueByMonth = createEmptyMonthlySeries();
  let pricedLineCount = 0;
  const cmv = createEmptyMonthlySeries();

  type PendingLine = {
    month: number;
    competenceDate: Date;
    quantity: number;
    lineRevenue: number;
    externalProductId: number | null;
    sku: string | null;
  };
  const pending: PendingLine[] = [];

  for (const nfe of nfes) {
    const raw = payloadById.get(nfe.nomusNfeId);
    let items = extractDreNfeItemsFromRawPayload(raw);
    if (items.length === 0) {
      const stockItems = stockByNfe.get(nfe.nfeExternalId) ?? [];
      items = stockItems.map((s) => ({
        externalProductId: s.externalProductId,
        sku: null,
        quantity: s.quantity,
        lineRevenue: null,
      }));
    }
    if (items.length === 0) {
      missingItemsNfeCount += 1;
      if (nfe.month >= 1 && nfe.month <= 12) {
        missingItemsRevenueByMonth[nfe.month - 1] += nfe.valorLiquido;
      }
      continue;
    }

    const revenueWeight = items.reduce((acc, it) => acc + Math.max(0, it.lineRevenue ?? 0), 0);
    for (const item of items) {
      const share =
        revenueWeight > 0 && item.lineRevenue != null
          ? (Math.max(0, item.lineRevenue) / revenueWeight) * nfe.valorLiquido
          : nfe.valorLiquido / items.length;
      pending.push({
        month: nfe.month,
        competenceDate: nfe.competenceDate,
        quantity: item.quantity,
        lineRevenue: share,
        externalProductId: item.externalProductId,
        sku: item.sku,
      });
    }
  }

  const externalIds = [
    ...new Set(
      pending
        .map((p) => p.externalProductId)
        .filter((id): id is number => id != null)
        .map(String)
    ),
  ];
  const skus = [
    ...new Set(pending.map((p) => p.sku).filter((s): s is string => Boolean(s?.trim()))),
  ];

  const products = await prisma.product.findMany({
    where: {
      OR: [
        ...(externalIds.length > 0 ? [{ sourceExternalId: { in: externalIds } }] : []),
        ...(skus.length > 0 ? [{ sku: { in: skus } }] : []),
      ],
    },
    select: { id: true, sourceExternalId: true, sku: true },
  });

  const byExternalId = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const p of products) {
    if (p.sourceExternalId) byExternalId.set(p.sourceExternalId, p.id);
    if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p.id);
  }

  // Catálogo Nomus → Product (quando sourceExternalId não bate)
  if (externalIds.length > 0) {
    const catalog = await prisma.nomusProductCatalog.findMany({
      where: { externalProductId: { in: externalIds } },
      select: { externalProductId: true, code: true },
    });
    const catalogCodes = catalog
      .map((c) => c.code?.trim())
      .filter((c): c is string => Boolean(c));
    if (catalogCodes.length > 0) {
      const byCode = await prisma.product.findMany({
        where: { sku: { in: catalogCodes } },
        select: { id: true, sku: true },
      });
      const productBySku = new Map(byCode.map((p) => [p.sku.trim().toLowerCase(), p.id]));
      for (const c of catalog) {
        if (c.externalProductId == null || !c.code) continue;
        const pid = productBySku.get(c.code.trim().toLowerCase());
        if (pid && !byExternalId.has(String(c.externalProductId))) {
          byExternalId.set(String(c.externalProductId), pid);
        }
      }
    }
  }

  const resolved: ResolvedLine[] = [];
  for (const line of pending) {
    const productId =
      (line.externalProductId != null
        ? byExternalId.get(String(line.externalProductId))
        : undefined) ??
      (line.sku ? bySku.get(line.sku.trim().toLowerCase()) : undefined);
    if (!productId) {
      missingProductLineCount += 1;
      if (line.month >= 1 && line.month <= 12) {
        missingProductRevenueByMonth[line.month - 1] += line.lineRevenue;
      }
      continue;
    }
    resolved.push({
      month: line.month,
      productId,
      quantity: line.quantity,
      competenceDate: line.competenceDate,
      lineRevenue: line.lineRevenue,
    });
  }

  const pairs: EffectiveProductionCostPair[] = resolved.map((r) => ({
    productId: r.productId,
    referenceDate: r.competenceDate,
  }));
  const costs = await getEffectiveProductProductionCostsForPairs(prisma, pairs);

  for (const line of resolved) {
    const key = effectiveProductionCostLookupKey(line.productId, line.competenceDate);
    const cost = costs.get(key);
    if (!cost || cost.status !== "OK" || !(cost.unitProductionCost > 0)) {
      missingCostLineCount += 1;
      if (line.month >= 1 && line.month <= 12) {
        missingCostRevenueByMonth[line.month - 1] += line.lineRevenue;
      }
      continue;
    }
    const amount = cost.unitProductionCost * line.quantity;
    if (line.month >= 1 && line.month <= 12) {
      cmv[line.month - 1] += amount;
      pricedLineCount += 1;
    }
  }

  return {
    cmv: cmv.map(roundDreMoney),
    missingItemsNfeCount,
    missingItemsRevenueByMonth: missingItemsRevenueByMonth.map(roundDreMoney),
    missingProductLineCount,
    missingProductRevenueByMonth: missingProductRevenueByMonth.map(roundDreMoney),
    missingCostLineCount,
    missingCostRevenueByMonth: missingCostRevenueByMonth.map(roundDreMoney),
    pricedLineCount,
  };
}
