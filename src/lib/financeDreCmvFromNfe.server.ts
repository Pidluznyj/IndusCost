/**
 * CMV do DRE Gerencial — item da NF-e × custo vigente na data da nota.
 * Não depende de vínculo com Pedido de Venda.
 */

import { prisma } from "@/src/lib/prisma.js";
import { queryFiscalNfesForDreCmv } from "@/src/lib/financeDreNfeQueries.server.js";
import {
  extractDreNfeItemsFromSources,
  mapNomusNfeItemRecord,
  type DreNfeExtractedItem,
} from "@/src/lib/financeDreNfeItemExtract.js";
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
  /** NF-e sem itens parseáveis (payload/XML/estoque). */
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

/** CMV agregado por NF-e (mesmo motor do DRE) — usado no drill-down. */
export type DreCmvByNfeRow = {
  nomusNfeId: string;
  nfeExternalId: number;
  month: number;
  amount: number;
};

/** Lacunas de CMV (mesmo motor) — para validação de fontes. */
export type DreCmvGapKind = "missing_items" | "missing_product" | "missing_cost";

export type DreCmvGapRow = {
  kind: DreCmvGapKind;
  nomusNfeId: string;
  nfeExternalId: number;
  month: number;
  competenceDate: Date;
  /** Receita associada à lacuna (mesma base do relatório informativo). */
  amount: number;
  externalProductId: number | null;
  sku: string | null;
  productId: string | null;
  quantity: number | null;
};

function parseNfeNumeroAsInt(numero: string | null | undefined): number | null {
  if (!numero?.trim()) return null;
  const digits = numero.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function mapStockDocItemsToDre(
  items: Array<{
    externalProductId: number | null;
    quantity: unknown;
    unitValue?: unknown;
    rawJson?: unknown;
  }>
): DreNfeExtractedItem[] {
  const out: DreNfeExtractedItem[] = [];
  for (const item of items) {
    const fromRaw =
      item.rawJson && typeof item.rawJson === "object" && !Array.isArray(item.rawJson)
        ? mapNomusNfeItemRecord(item.rawJson as Record<string, unknown>)
        : null;
    const qty = fromRaw?.quantity ?? decimalToNumber(item.quantity) ?? 0;
    if (qty <= 0) continue;
    const unitValue = decimalToNumber(item.unitValue);
    const lineRevenue =
      fromRaw?.lineRevenue ??
      (unitValue != null && Number.isFinite(unitValue) ? qty * unitValue : null);
    out.push({
      externalProductId: fromRaw?.externalProductId ?? item.externalProductId ?? null,
      sku: fromRaw?.sku ?? null,
      quantity: qty,
      lineRevenue,
    });
  }
  return out;
}

/**
 * Itens do Documento de Saída vinculados à NF-e.
 * Preferência: `idNfe === externalId` da nota; fallback: `idNfe === numero` impresso.
 */
async function loadStockItemsByNfeKeys(
  keys: Array<{ nfeExternalId: number; numero: number | null }>
): Promise<Map<number, DreNfeExtractedItem[]>> {
  const out = new Map<number, DreNfeExtractedItem[]>();
  if (keys.length === 0) return out;

  const lookupIds = new Set<number>();
  for (const k of keys) {
    lookupIds.add(k.nfeExternalId);
    if (k.numero != null) lookupIds.add(k.numero);
  }
  if (lookupIds.size === 0) return out;

  const docs = await prisma.nomusStockDocument.findMany({
    where: {
      idNfe: { in: [...lookupIds] },
      isCancelled: false,
    },
    select: {
      idNfe: true,
      items: {
        select: {
          externalProductId: true,
          quantity: true,
          unitValue: true,
          rawJson: true,
        },
      },
    },
  });

  const byIdNfe = new Map<number, DreNfeExtractedItem[]>();
  for (const doc of docs) {
    if (doc.idNfe == null) continue;
    const mapped = mapStockDocItemsToDre(doc.items);
    if (mapped.length === 0) continue;
    const list = byIdNfe.get(doc.idNfe) ?? [];
    list.push(...mapped);
    byIdNfe.set(doc.idNfe, list);
  }

  for (const k of keys) {
    const preferred = byIdNfe.get(k.nfeExternalId);
    if (preferred && preferred.length > 0) {
      out.set(k.nfeExternalId, preferred);
      continue;
    }
    if (k.numero != null && k.numero !== k.nfeExternalId) {
      const fallback = byIdNfe.get(k.numero);
      if (fallback && fallback.length > 0) out.set(k.nfeExternalId, fallback);
    }
  }
  return out;
}

type ResolvedLine = {
  nomusNfeId: string;
  nfeExternalId: number;
  month: number;
  productId: string;
  quantity: number;
  competenceDate: Date;
  lineRevenue: number;
};

async function computeMonthlyCmvFromNfeProductCosts(
  year: number,
  emitterCnpjDigits?: string
): Promise<{ result: DreCmvFromNfeResult; byNfe: DreCmvByNfeRow[]; gaps: DreCmvGapRow[] }> {
  const nfes = await queryFiscalNfesForDreCmv(year, "emissao", emitterCnpjDigits);
  const empty = (): {
    result: DreCmvFromNfeResult;
    byNfe: DreCmvByNfeRow[];
    gaps: DreCmvGapRow[];
  } => ({
    result: {
      cmv: emptyDreSeries(),
      missingItemsNfeCount: 0,
      missingItemsRevenueByMonth: emptyDreSeries(),
      missingProductLineCount: 0,
      missingProductRevenueByMonth: emptyDreSeries(),
      missingCostLineCount: 0,
      missingCostRevenueByMonth: emptyDreSeries(),
      pricedLineCount: 0,
    },
    byNfe: [],
    gaps: [],
  });
  if (nfes.length === 0) return empty();

  const nfeRows = await prisma.nomusNfe.findMany({
    where: { id: { in: nfes.map((n) => n.nomusNfeId) } },
    select: {
      id: true,
      externalId: true,
      numero: true,
      rawPayload: true,
      xmlRaw: true,
    },
  });
  const nfeMetaById = new Map(
    nfeRows.map((row) => [
      row.id,
      {
        rawPayload: row.rawPayload,
        xmlRaw: row.xmlRaw,
        numero: parseNfeNumeroAsInt(row.numero),
      },
    ])
  );
  const stockByNfe = await loadStockItemsByNfeKeys(
    nfes.map((n) => ({
      nfeExternalId: n.nfeExternalId,
      numero: nfeMetaById.get(n.nomusNfeId)?.numero ?? null,
    }))
  );

  let missingItemsNfeCount = 0;
  const missingItemsRevenueByMonth = createEmptyMonthlySeries();
  let missingProductLineCount = 0;
  const missingProductRevenueByMonth = createEmptyMonthlySeries();
  let missingCostLineCount = 0;
  const missingCostRevenueByMonth = createEmptyMonthlySeries();
  let pricedLineCount = 0;
  const cmv = createEmptyMonthlySeries();
  const gaps: DreCmvGapRow[] = [];

  type PendingLine = {
    nomusNfeId: string;
    nfeExternalId: number;
    month: number;
    competenceDate: Date;
    quantity: number;
    lineRevenue: number;
    externalProductId: number | null;
    sku: string | null;
  };
  const pending: PendingLine[] = [];

  for (const nfe of nfes) {
    const meta = nfeMetaById.get(nfe.nomusNfeId);
    let items = extractDreNfeItemsFromSources({
      rawPayload: meta?.rawPayload,
      xmlRaw: meta?.xmlRaw,
    });
    if (items.length === 0) {
      items = stockByNfe.get(nfe.nfeExternalId) ?? [];
    }
    if (items.length === 0) {
      missingItemsNfeCount += 1;
      if (nfe.month >= 1 && nfe.month <= 12) {
        missingItemsRevenueByMonth[nfe.month - 1] += nfe.valorLiquido;
      }
      gaps.push({
        kind: "missing_items",
        nomusNfeId: nfe.nomusNfeId,
        nfeExternalId: nfe.nfeExternalId,
        month: nfe.month,
        competenceDate: nfe.competenceDate,
        amount: nfe.valorLiquido,
        externalProductId: null,
        sku: null,
        productId: null,
        quantity: null,
      });
      continue;
    }

    const revenueWeight = items.reduce((acc, it) => acc + Math.max(0, it.lineRevenue ?? 0), 0);
    for (const item of items) {
      const share =
        revenueWeight > 0 && item.lineRevenue != null
          ? (Math.max(0, item.lineRevenue) / revenueWeight) * nfe.valorLiquido
          : nfe.valorLiquido / items.length;
      pending.push({
        nomusNfeId: nfe.nomusNfeId,
        nfeExternalId: nfe.nfeExternalId,
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

  // Catálogo Nomus → Product (id externo e/ou código comercial do XML)
  const catalogWhere =
    externalIds.length > 0 || skus.length > 0
      ? {
          OR: [
            ...(externalIds.length > 0 ? [{ externalProductId: { in: externalIds } }] : []),
            ...(skus.length > 0 ? [{ code: { in: skus } }] : []),
          ],
        }
      : null;
  if (catalogWhere) {
    const catalog = await prisma.nomusProductCatalog.findMany({
      where: catalogWhere,
      select: { externalProductId: true, code: true },
    });
    const catalogCodes = [
      ...new Set(catalog.map((c) => c.code?.trim()).filter((c): c is string => Boolean(c))),
    ];
    if (catalogCodes.length > 0) {
      const byCode = await prisma.product.findMany({
        where: { sku: { in: catalogCodes } },
        select: { id: true, sku: true, sourceExternalId: true },
      });
      const productBySku = new Map(byCode.map((p) => [p.sku.trim().toLowerCase(), p.id]));
      for (const p of byCode) {
        if (p.sourceExternalId) byExternalId.set(p.sourceExternalId, p.id);
        if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p.id);
      }
      for (const c of catalog) {
        if (!c.code) continue;
        const pid = productBySku.get(c.code.trim().toLowerCase());
        if (!pid) continue;
        bySku.set(c.code.trim().toLowerCase(), pid);
        if (c.externalProductId != null && !byExternalId.has(c.externalProductId)) {
          byExternalId.set(c.externalProductId, pid);
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
      gaps.push({
        kind: "missing_product",
        nomusNfeId: line.nomusNfeId,
        nfeExternalId: line.nfeExternalId,
        month: line.month,
        competenceDate: line.competenceDate,
        amount: line.lineRevenue,
        externalProductId: line.externalProductId,
        sku: line.sku,
        productId: null,
        quantity: line.quantity,
      });
      continue;
    }
    resolved.push({
      nomusNfeId: line.nomusNfeId,
      nfeExternalId: line.nfeExternalId,
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

  const byNfeMap = new Map<string, DreCmvByNfeRow>();
  for (const line of resolved) {
    const key = effectiveProductionCostLookupKey(line.productId, line.competenceDate);
    const cost = costs.get(key);
    if (!cost || cost.status !== "OK" || !(cost.unitProductionCost > 0)) {
      missingCostLineCount += 1;
      if (line.month >= 1 && line.month <= 12) {
        missingCostRevenueByMonth[line.month - 1] += line.lineRevenue;
      }
      gaps.push({
        kind: "missing_cost",
        nomusNfeId: line.nomusNfeId,
        nfeExternalId: line.nfeExternalId,
        month: line.month,
        competenceDate: line.competenceDate,
        amount: line.lineRevenue,
        externalProductId: null,
        sku: null,
        productId: line.productId,
        quantity: line.quantity,
      });
      continue;
    }
    const amount = cost.unitProductionCost * line.quantity;
    if (line.month >= 1 && line.month <= 12) {
      cmv[line.month - 1] += amount;
      pricedLineCount += 1;
      const existing = byNfeMap.get(line.nomusNfeId);
      if (existing) {
        existing.amount += amount;
      } else {
        byNfeMap.set(line.nomusNfeId, {
          nomusNfeId: line.nomusNfeId,
          nfeExternalId: line.nfeExternalId,
          month: line.month,
          amount,
        });
      }
    }
  }

  return {
    result: {
      cmv: cmv.map(roundDreMoney),
      missingItemsNfeCount,
      missingItemsRevenueByMonth: missingItemsRevenueByMonth.map(roundDreMoney),
      missingProductLineCount,
      missingProductRevenueByMonth: missingProductRevenueByMonth.map(roundDreMoney),
      missingCostLineCount,
      missingCostRevenueByMonth: missingCostRevenueByMonth.map(roundDreMoney),
      pricedLineCount,
    },
    byNfe: [...byNfeMap.values()].map((row) => ({
      ...row,
      amount: roundDreMoney(row.amount),
    })),
    gaps: gaps.map((row) => ({
      ...row,
      amount: roundDreMoney(row.amount),
    })),
  };
}

export async function loadMonthlyCmvFromNfeProductCosts(
  year: number,
  emitterCnpjDigits?: string
): Promise<DreCmvFromNfeResult> {
  const { result } = await computeMonthlyCmvFromNfeProductCosts(year, emitterCnpjDigits);
  return result;
}

/** CMV por NF-e no intervalo de meses (mesmo cálculo do DRE). */
export async function loadCmvByNfeForMonthRange(
  year: number,
  fromMonth: number,
  toMonth: number,
  emitterCnpjDigits?: string
): Promise<DreCmvByNfeRow[]> {
  const { byNfe } = await computeMonthlyCmvFromNfeProductCosts(year, emitterCnpjDigits);
  return byNfe.filter((row) => row.month >= fromMonth && row.month <= toMonth);
}

/** Bundle drill-down: série mensal + CMV por NF-e (uma só passagem). */
export async function loadCmvDrilldownBundle(
  year: number,
  fromMonth: number,
  toMonth: number,
  emitterCnpjDigits?: string
): Promise<{ monthlyCmv: number[]; byNfe: DreCmvByNfeRow[] }> {
  const { result, byNfe } = await computeMonthlyCmvFromNfeProductCosts(
    year,
    emitterCnpjDigits
  );
  return {
    monthlyCmv: result.cmv,
    byNfe: byNfe.filter((row) => row.month >= fromMonth && row.month <= toMonth),
  };
}

/** Lacunas de CMV no intervalo (para validação de fontes). */
export async function loadCmvGapsForMonthRange(
  year: number,
  fromMonth: number,
  toMonth: number,
  emitterCnpjDigits?: string
): Promise<DreCmvGapRow[]> {
  const { gaps } = await computeMonthlyCmvFromNfeProductCosts(year, emitterCnpjDigits);
  return gaps.filter((row) => row.month >= fromMonth && row.month <= toMonth);
}
