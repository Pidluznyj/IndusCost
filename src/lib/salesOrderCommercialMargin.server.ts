/**
 * Adapter server-only: margem comercial do Pedido sem Proposta.
 * Formação histórica em lote (sem Prisma dentro do loop de itens).
 */
import type { PrismaClient } from "@prisma/client";
import {
  COMMERCIAL_PRICE_TIER_CODES,
  resolveCommercialPriceTier,
  type CommercialPriceTierRow,
  type CommercialPriceTierCode,
} from "./commissions/commission-commercial-tier.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  calculateSalesOrderItemCommercialMargin,
  readExplicitAbsolute,
  readExplicitRate,
  resolveActiveSoldQuantity,
  summarizeSalesOrderCommercialMargins,
  unavailableCommercialMarginItem,
  type SalesOrderCommercialMarginItemPayload,
  type SalesOrderCommercialMarginReasonCode,
  type SalesOrderCommercialMarginSummaryPayload,
} from "./salesOrderCommercialMargin.js";
import type { SalesOrderItemForMargin } from "./salesOrderMarginService.server.js";

type Decimalish = { toNumber?: () => number } | number | string | null | undefined;

function toNum(value: Decimalish): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const COST_EPS = 1e-6;
const RATE_EPS = 1e-9;

export type HistoricalFormationRates = {
  frozenCostUnit: number;
  taxRate: number;
  otherRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
};

export type HistoricalTieret = {
  ok: true;
  historicalContextId: string;
  referenceDate: string;
  versionIdsByCode: Record<CommercialPriceTierCode, string>;
  rates: HistoricalFormationRates;
  tiers: CommercialPriceTierRow[];
  /** Versão ATACADO (referência de formação). */
  anchorPriceTableVersionId: string;
};

export type HistoricalTieretFailure = {
  ok: false;
  reasonCode: SalesOrderCommercialMarginReasonCode;
  message: string;
};

export type HistoricalTieretResult = HistoricalTieret | HistoricalTieretFailure;

type LoadedItem = {
  priceTableVersionId: string;
  productId: string;
  frozenTotalCost: unknown;
  marginPct: unknown;
  salePrice: unknown;
  commissionPerc: unknown;
  formulaSnapshotJson: unknown;
};

function extractFormationRatesFromItem(
  item: LoadedItem
):
  | { ok: true; rates: HistoricalFormationRates }
  | { ok: false; reasonCode: SalesOrderCommercialMarginReasonCode; message: string } {
  const cost = toNum(item.frozenTotalCost);
  if (cost == null || cost <= 0) {
    return {
      ok: false,
      reasonCode: "COST_NOT_FOUND",
      message: "Não encontramos custo válido para a data do Pedido.",
    };
  }

  const formula = asRecord(item.formulaSnapshotJson);
  if (!formula) {
    return {
      ok: false,
      reasonCode: "PRODUCT_WITHOUT_PRICE_FORMATION",
      message: "Produto sem formação de preço cadastrada (formulaSnapshot ausente).",
    };
  }

  const rates = asRecord(formula.rates);
  if (!rates) {
    return {
      ok: false,
      reasonCode: "PRODUCT_WITHOUT_PRICE_FORMATION",
      message: "A formação de preço está incompleta (rates ausentes).",
    };
  }

  const tax = readExplicitRate(rates.taxRate);
  if (!tax.present) {
    return { ok: false, reasonCode: "TAX_NOT_FOUND", message: "Imposto da formação ausente." };
  }

  const other = readExplicitRate(rates.otherRate);
  if (!other.present) {
    return {
      ok: false,
      reasonCode: "OTHER_VARIABLES_NOT_DEFINED",
      message: "Outras variáveis da formação ausentes.",
    };
  }

  let freightRate: number | null = null;
  const freightRateRaw = readExplicitRate(rates.freightRate);
  if (freightRateRaw.present) {
    freightRate = freightRateRaw.value;
  } else {
    // freightPercent no snapshot é percentual explícito (ex.: 3 = 3%).
    const freightPercent = readExplicitAbsolute(formula.freightPercent);
    if (freightPercent.present) {
      freightRate = freightPercent.value / 100;
    }
  }
  if (freightRate == null) {
    return {
      ok: false,
      reasonCode: "FREIGHT_NOT_DEFINED",
      message: "Frete percentual da formação ausente.",
    };
  }

  const freightAbs = readExplicitAbsolute(formula.freight);
  if (!freightAbs.present) {
    return {
      ok: false,
      reasonCode: "FREIGHT_NOT_DEFINED",
      message: "Frete absoluto da formação ausente.",
    };
  }

  return {
    ok: true,
    rates: {
      frozenCostUnit: cost,
      taxRate: tax.value,
      otherRate: other.value,
      freightRate,
      freightAbsoluteUnit: freightAbs.value,
    },
  };
}

function ratesEqual(a: HistoricalFormationRates, b: HistoricalFormationRates): boolean {
  return (
    Math.abs(a.frozenCostUnit - b.frozenCostUnit) <= COST_EPS &&
    Math.abs(a.taxRate - b.taxRate) <= RATE_EPS &&
    Math.abs(a.otherRate - b.otherRate) <= RATE_EPS &&
    Math.abs(a.freightRate - b.freightRate) <= RATE_EPS &&
    Math.abs(a.freightAbsoluteUnit - b.freightAbsoluteUnit) <= COST_EPS
  );
}

/**
 * Carrega conjuntos históricos coerentes (4 faixas) para vários produtos em uma data.
 * Consultas: tabelas (1) + versões (≤4) + itens (1) — sem N+1 por produto.
 */
export async function loadHistoricalCommercialFormationsBatch(
  db: PrismaClient,
  productIds: string[],
  referenceDate: Date
): Promise<Map<string, HistoricalTieretResult>> {
  const result = new Map<string, HistoricalTieretResult>();
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const refIso = toCivilDateKey(referenceDate);
  if (!refIso) {
    for (const id of uniqueProductIds) {
      result.set(id, {
        ok: false,
        reasonCode: "MISSING_ORDER_DATE",
        message: "Pedido sem data de emissão.",
      });
    }
    return result;
  }

  if (uniqueProductIds.length === 0) return result;

  const tables = await db.priceTable.findMany({
    where: { code: { in: [...COMMERCIAL_PRICE_TIER_CODES] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });
  const tableByCode = new Map(tables.map((t) => [t.code as CommercialPriceTierCode, t]));
  const missingCodes = COMMERCIAL_PRICE_TIER_CODES.filter((c) => !tableByCode.has(c));
  if (missingCodes.length > 0) {
    for (const id of uniqueProductIds) {
      result.set(id, {
        ok: false,
        reasonCode: "INCOMPLETE_MARGIN_TIERS",
        message: `Tabelas comerciais ausentes: ${missingCodes.join(", ")}.`,
      });
    }
    return result;
  }

  const versionIdsByCode = {} as Record<CommercialPriceTierCode, string>;
  const versionIdToCode = new Map<string, CommercialPriceTierCode>();

  for (const code of COMMERCIAL_PRICE_TIER_CODES) {
    const table = tableByCode.get(code)!;
    // Até 2 versões sobrepostas: detecta ambiguidade sem inventar qual usar.
    const overlapping = await db.priceTableVersion.findMany({
      where: {
        priceTableId: table.id,
        status: { in: ["PUBLISHED", "ARCHIVED"] },
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: referenceDate } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: referenceDate } }] },
        ],
      },
      orderBy: [{ effectiveFrom: "desc" }, { publishedAt: "desc" }, { versionNumber: "desc" }],
      take: 2,
      select: { id: true },
    });
    if (overlapping.length === 0) {
      for (const id of uniqueProductIds) {
        result.set(id, {
          ok: false,
          reasonCode: "HISTORICAL_FORMATION_NOT_FOUND",
          message: `Sem versão publicada de ${code} na data do Pedido.`,
        });
      }
      return result;
    }
    if (overlapping.length > 1) {
      for (const id of uniqueProductIds) {
        result.set(id, {
          ok: false,
          reasonCode: "HISTORICAL_FORMATION_AMBIGUOUS",
          message: `Existem duas formações possíveis de ${code} para essa data.`,
        });
      }
      return result;
    }
    const version = overlapping[0]!;
    versionIdsByCode[code] = version.id;
    versionIdToCode.set(version.id, code);
  }

  const versionIds = Object.values(versionIdsByCode);
  const historicalContextId = versionIds.slice().sort().join("|");

  const items = await db.priceTableItem.findMany({
    where: {
      priceTableVersionId: { in: versionIds },
      productId: { in: uniqueProductIds },
    },
    select: {
      priceTableVersionId: true,
      productId: true,
      frozenTotalCost: true,
      marginPct: true,
      salePrice: true,
      commissionPerc: true,
      formulaSnapshotJson: true,
    },
  });

  const itemsByProduct = new Map<string, Map<CommercialPriceTierCode, LoadedItem>>();
  for (const item of items) {
    const code = versionIdToCode.get(item.priceTableVersionId);
    if (!code) continue;
    let byCode = itemsByProduct.get(item.productId);
    if (!byCode) {
      byCode = new Map();
      itemsByProduct.set(item.productId, byCode);
    }
    byCode.set(code, item);
  }

  for (const productId of uniqueProductIds) {
    const byCode = itemsByProduct.get(productId);
    if (!byCode || byCode.size < COMMERCIAL_PRICE_TIER_CODES.length) {
      const missing = COMMERCIAL_PRICE_TIER_CODES.filter((c) => !byCode?.has(c));
      result.set(productId, {
        ok: false,
        reasonCode:
          !byCode || byCode.size === 0
            ? "PRODUCT_WITHOUT_PRICE_FORMATION"
            : "INCOMPLETE_MARGIN_TIERS",
        message:
          !byCode || byCode.size === 0
            ? "Produto sem formação de preço cadastrada."
            : `Faixas incompletas na data do Pedido: ${missing.join(", ")}.`,
      });
      continue;
    }

    const tiers: CommercialPriceTierRow[] = [];
    let anchorRates: HistoricalFormationRates | null = null;
    let inconsistent = false;
    let rateFailure: HistoricalTieretFailure | null = null;

    for (const code of COMMERCIAL_PRICE_TIER_CODES) {
      const item = byCode.get(code)!;
      const salePrice = toNum(item.salePrice);
      const commissionPercent = toNum(item.commissionPerc);
      if (salePrice == null || salePrice <= 0) {
        rateFailure = {
          ok: false,
          reasonCode: "PRODUCT_WITHOUT_PRICE_FORMATION",
          message: `Faixa ${code} sem preço de venda válido.`,
        };
        break;
      }
      // Motor oficial de comissão exige percentual > 0; null/≤0 = não definido.
      if (commissionPercent == null || commissionPercent <= 0) {
        rateFailure = {
          ok: false,
          reasonCode: "COMMISSION_NOT_DEFINED",
          message: `Faixa ${code} sem percentual de comissão.`,
        };
        break;
      }

      const extracted = extractFormationRatesFromItem(item);
      if (!extracted.ok) {
        rateFailure = {
          ok: false,
          reasonCode: extracted.reasonCode,
          message: extracted.message,
        };
        break;
      }

      if (!anchorRates) {
        anchorRates = extracted.rates;
      } else if (!ratesEqual(anchorRates, extracted.rates)) {
        inconsistent = true;
        break;
      }

      const table = tableByCode.get(code)!;
      tiers.push({
        code,
        name: table.name,
        salePrice,
        commissionPercent,
      });
    }

    if (rateFailure) {
      result.set(productId, rateFailure);
      continue;
    }
    if (inconsistent || !anchorRates) {
      result.set(productId, {
        ok: false,
        reasonCode: "INCONSISTENT_PRICE_FORMATION_SET",
        message:
          "As faixas comerciais da data do Pedido têm custo/imposto/frete/outras variáveis inconsistentes.",
      });
      continue;
    }

    result.set(productId, {
      ok: true,
      historicalContextId,
      referenceDate: refIso,
      versionIdsByCode,
      rates: anchorRates,
      tiers,
      anchorPriceTableVersionId: versionIdsByCode.ATACADO,
    });
  }

  return result;
}

export async function calculateCommercialMarginsForSalesOrders(
  prisma: PrismaClient,
  orders: Array<{
    id: string;
    issueDate?: Date | string | null;
    items?: SalesOrderItemForMargin[] | null;
  }>
): Promise<
  Map<
    string,
    {
      summary: SalesOrderCommercialMarginSummaryPayload;
      byItemId: Map<string, SalesOrderCommercialMarginItemPayload>;
    }
  >
> {
  const result = new Map<
    string,
    {
      summary: SalesOrderCommercialMarginSummaryPayload;
      byItemId: Map<string, SalesOrderCommercialMarginItemPayload>;
    }
  >();

  if (orders.length === 0) return result;

  type WorkItem = {
    orderId: string;
    item: SalesOrderItemForMargin;
    soldQuantity: number;
    negotiatedUnitPrice: number;
    soldValuePreview: number;
    refIso: string | null;
    referenceDate: Date | null;
  };

  const workItems: WorkItem[] = [];
  const productIdsByDate = new Map<string, { date: Date; productIds: Set<string> }>();

  for (const order of orders) {
    const refRaw = order.issueDate;
    const referenceDate =
      refRaw instanceof Date ? refRaw : refRaw ? new Date(refRaw) : null;
    const refOk = referenceDate && Number.isFinite(referenceDate.getTime());
    const refIso = refOk ? toCivilDateKey(referenceDate!) : null;

    for (const item of order.items ?? []) {
      const orderedQty = toNum(item.quantity) ?? 0;
      const canceledQty = toNum(item.canceledQuantity) ?? 0;
      const isFullyCanceled =
        item.nomusIsCanceled === true ||
        item.nomusIsCut === true ||
        (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED" ||
        (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELADO" ||
        (orderedQty > 0 && canceledQty >= orderedQty);
      const soldQuantity = resolveActiveSoldQuantity({
        orderedQuantity: orderedQty,
        canceledQuantity: canceledQty,
        isFullyCanceled,
      });
      // Preço praticado do Pedido (já líquido de desconto no espelho Nomus/IndusCost).
      // Não reaplicar desconto sobre negotiatedPrice.
      const negotiatedUnitPrice = toNum(item.negotiatedPrice);
      const price = negotiatedUnitPrice != null && negotiatedUnitPrice > 0 ? negotiatedUnitPrice : NaN;
      const soldValuePreview =
        soldQuantity > 0 && Number.isFinite(price) ? soldQuantity * price : 0;

      workItems.push({
        orderId: order.id,
        item,
        soldQuantity,
        negotiatedUnitPrice: Number.isFinite(price) ? price : 0,
        soldValuePreview,
        refIso,
        referenceDate: refOk ? referenceDate! : null,
      });

      if (refOk && item.productId && soldQuantity > 0) {
        const key = refIso!;
        let bucket = productIdsByDate.get(key);
        if (!bucket) {
          bucket = { date: referenceDate!, productIds: new Set() };
          productIdsByDate.set(key, bucket);
        }
        bucket.productIds.add(item.productId);
      }
    }
  }

  /** productId|dateIso → formation */
  const formationByKey = new Map<string, HistoricalTieretResult>();
  for (const [dateIso, bucket] of productIdsByDate) {
    const batch = await loadHistoricalCommercialFormationsBatch(
      prisma,
      [...bucket.productIds],
      bucket.date
    );
    for (const [productId, formation] of batch) {
      formationByKey.set(`${productId}|${dateIso}`, formation);
    }
  }

  const byOrderPayloads = new Map<
    string,
    {
      byItemId: Map<string, SalesOrderCommercialMarginItemPayload>;
      itemPayloads: SalesOrderCommercialMarginItemPayload[];
      totalActiveSoldValue: number;
    }
  >();

  for (const order of orders) {
    byOrderPayloads.set(order.id, {
      byItemId: new Map(),
      itemPayloads: [],
      totalActiveSoldValue: 0,
    });
  }

  for (const work of workItems) {
    const orderBag = byOrderPayloads.get(work.orderId)!;
    if (work.soldQuantity > 0 && work.soldValuePreview > 0) {
      orderBag.totalActiveSoldValue += work.soldValuePreview;
    }

    if (!work.refIso || !work.referenceDate) {
      const unavailable = unavailableCommercialMarginItem({
        soldQuantity: work.soldQuantity,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: work.soldValuePreview,
        referenceDate: work.refIso,
        reasonCode: "MISSING_ORDER_DATE",
      });
      orderBag.byItemId.set(work.item.id, unavailable);
      if (work.soldQuantity > 0) orderBag.itemPayloads.push(unavailable);
      continue;
    }

    if (!work.item.productId) {
      const unavailable = unavailableCommercialMarginItem({
        soldQuantity: work.soldQuantity,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: work.soldValuePreview,
        referenceDate: work.refIso,
        reasonCode: "MISSING_PRODUCT",
      });
      orderBag.byItemId.set(work.item.id, unavailable);
      if (work.soldQuantity > 0) orderBag.itemPayloads.push(unavailable);
      continue;
    }

    if (work.soldQuantity <= 0) {
      const skipped = unavailableCommercialMarginItem({
        soldQuantity: 0,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: 0,
        referenceDate: work.refIso,
        reasonCode: "ITEM_CANCELED",
      });
      orderBag.byItemId.set(work.item.id, skipped);
      continue;
    }

    if (!(work.negotiatedUnitPrice > 0)) {
      const unavailable = unavailableCommercialMarginItem({
        soldQuantity: work.soldQuantity,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: 0,
        referenceDate: work.refIso,
        reasonCode: "INVALID_NEGOTIATED_PRICE",
      });
      orderBag.byItemId.set(work.item.id, unavailable);
      orderBag.itemPayloads.push(unavailable);
      continue;
    }

    const formation = formationByKey.get(`${work.item.productId}|${work.refIso}`);
    if (!formation || !formation.ok) {
      const unavailable = unavailableCommercialMarginItem({
        soldQuantity: work.soldQuantity,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: work.soldValuePreview,
        referenceDate: work.refIso,
        reasonCode: formation?.ok === false ? formation.reasonCode : "HISTORICAL_FORMATION_NOT_FOUND",
        warnings:
          formation?.ok === false
            ? [formation.message]
            : undefined,
      });
      orderBag.byItemId.set(work.item.id, unavailable);
      orderBag.itemPayloads.push(unavailable);
      continue;
    }

    const tierResolution = resolveCommercialPriceTier({
      soldUnitPrice: work.negotiatedUnitPrice,
      tiers: formation.tiers,
    });
    if (!tierResolution.ok) {
      const unavailable = unavailableCommercialMarginItem({
        soldQuantity: work.soldQuantity,
        negotiatedUnitPrice: work.negotiatedUnitPrice,
        soldValue: work.soldValuePreview,
        referenceDate: work.refIso,
        reasonCode:
          tierResolution.code === "NO_COMMISSION_TABLE_RATE"
            ? "COMMISSION_NOT_DEFINED"
            : tierResolution.code === "INVALID_COMMERCIAL_PRICE_RANGE"
              ? "INCONSISTENT_PRICE_FORMATION_SET"
              : "INCOMPLETE_MARGIN_TIERS",
        warnings: [tierResolution.message],
      });
      orderBag.byItemId.set(work.item.id, unavailable);
      orderBag.itemPayloads.push(unavailable);
      continue;
    }

    const commissionRate = tierResolution.ratePercent / 100;
    const interpolation = tierResolution.interpolation;
    const payload = calculateSalesOrderItemCommercialMargin({
      soldQuantity: work.soldQuantity,
      negotiatedUnitPrice: work.negotiatedUnitPrice,
      frozenTotalCost: formation.rates.frozenCostUnit,
      rates: {
        taxRate: formation.rates.taxRate,
        commissionRate,
        otherRate: formation.rates.otherRate,
        freightRate: formation.rates.freightRate,
        freight: formation.rates.freightAbsoluteUnit,
      },
      historicalContextId: formation.historicalContextId,
      priceTableVersionId: formation.anchorPriceTableVersionId,
      referenceDate: work.refIso,
      lowerMarginBand: interpolation?.fromTierCode ?? tierResolution.tierCode,
      upperMarginBand: interpolation?.toTierCode ?? tierResolution.tierCode,
      lowerBandPrice: interpolation?.fromSalePrice ?? null,
      upperBandPrice: interpolation?.toSalePrice ?? null,
      warnings: tierResolution.outOfTablePrice
        ? ["Preço abaixo da menor faixa — comissão fora de tabela."]
        : [],
    });

    orderBag.byItemId.set(work.item.id, payload);
    orderBag.itemPayloads.push(payload);
  }

  for (const order of orders) {
    const bag = byOrderPayloads.get(order.id)!;
    result.set(order.id, {
      summary: summarizeSalesOrderCommercialMargins(bag.itemPayloads, {
        totalActiveSoldValue: bag.totalActiveSoldValue,
      }),
      byItemId: bag.byItemId,
    });
  }

  return result;
}
