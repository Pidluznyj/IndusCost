/**
 * Adapter server-only: resolve formação histórica e calcula margem comercial do Pedido.
 */
import type { PrismaClient } from "@prisma/client";
import {
  COMMERCIAL_PRICE_TIER_CODES,
  resolveCommercialPriceTier,
  type CommercialPriceTierRow,
} from "./commissions/commission-commercial-tier.js";
import {
  CommercialTierCache,
  loadCommercialPriceTiersForProduct,
} from "./commissions/commission-commercial-tier.server.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import { resolvePublishedPriceTableVersionForDate } from "./priceTablePublication.server.js";
import {
  calculateSalesOrderItemCommercialMargin,
  resolveActiveSoldQuantity,
  summarizeSalesOrderCommercialMargins,
  unavailableCommercialMarginItem,
  type SalesOrderCommercialMarginItemPayload,
  type SalesOrderCommercialMarginSummaryPayload,
} from "./salesOrderCommercialMargin.js";
import type { SalesOrderItemForMargin } from "./salesOrderMarginService.server.js";

type Decimalish = { toNumber?: () => number } | number | string | null | undefined;

function toNum(value: Decimalish, fallback = 0): number {
  if (value == null || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rateFromPercentOrFraction(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

type FormationBundle = {
  frozenTotalCost: number;
  taxRate: number;
  otherRate: number;
  freightRate: number;
  freightAbs: number;
  priceTableVersionId: string | null;
  source: "EXACT_PROPOSAL_SNAPSHOT" | "EXACT_PRICE_TABLE_VERSION" | "RECONSTRUCTED_AT_ORDER_DATE";
  warnings: string[];
};

function extractFormationFromPricingSnapshot(
  snapshot: unknown
): FormationBundle | null {
  const root = asRecord(snapshot);
  if (!root) return null;

  const item = asRecord(root.item) ?? root;
  const formula = asRecord(item.formulaSnapshotJson) ?? asRecord(root.formulaSnapshotJson);
  const rates = asRecord(formula?.rates) ?? asRecord(item.rates);
  const outputs = asRecord(formula?.outputs);

  const frozenTotalCost =
    toNum(item.frozenTotalCost, NaN) ||
    toNum(outputs?.frozenTotalCost, NaN) ||
    toNum(asRecord(root.proposalDefaults)?.unitCost, NaN);

  const taxRate =
    rateFromPercentOrFraction(rates?.taxRate) ??
    rateFromPercentOrFraction(item.taxRate) ??
    null;
  const otherRate = rateFromPercentOrFraction(rates?.otherRate) ?? 0;
  const freightRate =
    rateFromPercentOrFraction(rates?.freightRate) ??
    rateFromPercentOrFraction(item.freightPercent) ??
    rateFromPercentOrFraction(formula?.freightPercent) ??
    rateFromPercentOrFraction(asRecord(root.proposalDefaults)?.freightPercent) ??
    0;
  const freightAbs =
    toNum(formula?.freight, NaN) >= 0 && Number.isFinite(toNum(formula?.freight, NaN))
      ? toNum(formula?.freight, 0)
      : toNum(item.freightAbsolute, 0) ||
        toNum(asRecord(root.proposalDefaults)?.freightAbsolute, 0);

  const version =
    asRecord(root.version) ??
    null;
  const priceTableVersionId =
    (typeof formula?.priceTableVersionId === "string" && formula.priceTableVersionId) ||
    (typeof version?.id === "string" && version.id) ||
    (typeof item.priceTableVersionId === "string" && item.priceTableVersionId) ||
    null;

  if (!Number.isFinite(frozenTotalCost) || frozenTotalCost <= 0 || taxRate == null) {
    return null;
  }

  return {
    frozenTotalCost,
    taxRate,
    otherRate,
    freightRate,
    freightAbs,
    priceTableVersionId,
    source: "EXACT_PROPOSAL_SNAPSHOT",
    warnings: [],
  };
}

async function loadFormationFromPriceTableVersion(
  db: PrismaClient,
  priceTableVersionId: string,
  productId: string
): Promise<FormationBundle | null> {
  const item = await db.priceTableItem.findUnique({
    where: {
      priceTableVersionId_productId: { priceTableVersionId, productId },
    },
    select: {
      frozenTotalCost: true,
      formulaSnapshotJson: true,
      salePrice: true,
      PriceTableVersion: { select: { freightPercent: true } },
    },
  });
  if (!item) return null;
  const formula = asRecord(item.formulaSnapshotJson);
  const rates = asRecord(formula?.rates);
  const frozenTotalCost = toNum(item.frozenTotalCost, NaN);
  const taxRate = rateFromPercentOrFraction(rates?.taxRate);
  if (!Number.isFinite(frozenTotalCost) || frozenTotalCost <= 0 || taxRate == null) {
    return null;
  }
  return {
    frozenTotalCost,
    taxRate,
    otherRate: rateFromPercentOrFraction(rates?.otherRate) ?? 0,
    freightRate:
      rateFromPercentOrFraction(rates?.freightRate) ??
      rateFromPercentOrFraction(item.PriceTableVersion?.freightPercent) ??
      rateFromPercentOrFraction(formula?.freightPercent) ??
      0,
    freightAbs: toNum(formula?.freight, 0),
    priceTableVersionId,
    source: "EXACT_PRICE_TABLE_VERSION",
    warnings: [],
  };
}

async function reconstructFormationAtOrderDate(
  db: PrismaClient,
  priceTableId: string,
  productId: string,
  referenceDate: Date
): Promise<FormationBundle | null> {
  const version = await resolvePublishedPriceTableVersionForDate(
    db,
    priceTableId,
    referenceDate
  );
  if (!version) return null;
  const bundle = await loadFormationFromPriceTableVersion(db, version.id, productId);
  if (!bundle) return null;
  return {
    ...bundle,
    source: "RECONSTRUCTED_AT_ORDER_DATE",
    warnings: [
      "Formação reconstruída pela versão da tabela comercial vigente na data do pedido.",
    ],
  };
}

function bandLabelFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return code;
}

export async function calculateCommercialMarginsForSalesOrders(
  prisma: PrismaClient,
  orders: Array<{
    id: string;
    proposalId?: string | null;
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

  const proposalItemIds = [
    ...new Set(
      orders.flatMap((o) => (o.items ?? []).map((i) => i.proposalItemId).filter(Boolean))
    ),
  ] as string[];
  const proposalIds = [
    ...new Set(orders.map((o) => o.proposalId).filter(Boolean)),
  ] as string[];

  const [proposalItems, proposals] = await Promise.all([
    proposalItemIds.length
      ? prisma.proposalItem.findMany({
          where: { id: { in: proposalItemIds } },
          select: {
            id: true,
            priceTableId: true,
            priceTableVersionId: true,
            pricingSnapshotJson: true,
            unitCost: true,
            taxesPerc: true,
            commissionPerc: true,
            freightValue: true,
            negotiatedPrice: true,
          },
        })
      : Promise.resolve([]),
    proposalIds.length
      ? prisma.proposal.findMany({
          where: { id: { in: proposalIds } },
          select: { id: true, priceTableId: true, priceTableCode: true },
        })
      : Promise.resolve([]),
  ]);

  const proposalItemById = new Map(proposalItems.map((p) => [p.id, p]));
  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const tiersCache = new CommercialTierCache(prisma);

  for (const order of orders) {
    const refRaw = order.issueDate;
    const referenceDate =
      refRaw instanceof Date
        ? refRaw
        : refRaw
          ? new Date(refRaw)
          : null;
    const refOk = referenceDate && Number.isFinite(referenceDate.getTime());
    const refIso = refOk ? toCivilDateKey(referenceDate!) : null;
    const byItemId = new Map<string, SalesOrderCommercialMarginItemPayload>();
    const itemPayloads: SalesOrderCommercialMarginItemPayload[] = [];
    let totalActiveSoldValue = 0;

    for (const item of order.items ?? []) {
      const orderedQty = toNum(item.quantity, 0);
      const canceledQty = toNum(item.canceledQuantity, 0);
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
      const negotiatedUnitPrice = toNum(item.negotiatedPrice, NaN);
      const soldValuePreview =
        soldQuantity > 0 && Number.isFinite(negotiatedUnitPrice)
          ? soldQuantity * negotiatedUnitPrice
          : 0;
      if (soldQuantity > 0 && soldValuePreview > 0) {
        totalActiveSoldValue += soldValuePreview;
      }

      if (!refOk || !item.productId) {
        const unavailable = unavailableCommercialMarginItem({
          soldQuantity,
          negotiatedUnitPrice: Number.isFinite(negotiatedUnitPrice) ? negotiatedUnitPrice : 0,
          soldValue: soldValuePreview,
          referenceDate: refIso,
          warnings: [
            !refOk
              ? "Pedido sem data de emissão para reconstrução histórica."
              : "Item sem produto vinculado.",
          ],
        });
        byItemId.set(item.id, unavailable);
        itemPayloads.push(unavailable);
        continue;
      }

      if (soldQuantity <= 0) {
        const skipped = unavailableCommercialMarginItem({
          soldQuantity: 0,
          negotiatedUnitPrice: Number.isFinite(negotiatedUnitPrice) ? negotiatedUnitPrice : 0,
          soldValue: 0,
          referenceDate: refIso,
          warnings: ["Item cancelado — excluído da margem comercial."],
        });
        byItemId.set(item.id, skipped);
        continue;
      }

      const proposalItem = item.proposalItemId
        ? proposalItemById.get(item.proposalItemId)
        : undefined;
      const proposal = order.proposalId ? proposalById.get(order.proposalId) : undefined;

      let formation =
        extractFormationFromPricingSnapshot(proposalItem?.pricingSnapshotJson) ?? null;

      if (!formation && proposalItem) {
        const cost = toNum(proposalItem.unitCost, NaN);
        const taxRate = rateFromPercentOrFraction(proposalItem.taxesPerc);
        const snap = asRecord(proposalItem.pricingSnapshotJson);
        const defaults = asRecord(snap?.proposalDefaults);
        if (Number.isFinite(cost) && cost > 0 && taxRate != null) {
          formation = {
            frozenTotalCost: cost,
            taxRate,
            otherRate: 0,
            freightRate: rateFromPercentOrFraction(defaults?.freightPercent) ?? 0,
            freightAbs:
              toNum(defaults?.freightAbsolute, 0) ||
              (toNum(proposalItem.freightValue, 0) > 0 && toNum(proposalItem.quantity as never, 0) > 0
                ? 0
                : 0),
            priceTableVersionId: proposalItem.priceTableVersionId ?? null,
            source: "EXACT_PROPOSAL_SNAPSHOT",
            warnings: [
              "Formação parcialmente recuperada dos campos da proposta (snapshot incompleto).",
            ],
          };
        }
      }

      if (!formation && proposalItem?.priceTableVersionId && item.productId) {
        formation = await loadFormationFromPriceTableVersion(
          prisma,
          proposalItem.priceTableVersionId,
          item.productId
        );
      }

      const priceTableId =
        proposalItem?.priceTableId ?? proposal?.priceTableId ?? null;
      if (!formation && priceTableId) {
        formation = await reconstructFormationAtOrderDate(
          prisma,
          priceTableId,
          item.productId,
          referenceDate!
        );
      }

      let tiersResult: Awaited<ReturnType<CommercialTierCache["get"]>>;
      try {
        tiersResult = await tiersCache.get(item.productId, referenceDate!);
      } catch {
        const unavailable = unavailableCommercialMarginItem({
          soldQuantity,
          negotiatedUnitPrice,
          soldValue: soldValuePreview,
          referenceDate: refIso,
          warnings: [
            "Faixas comerciais (Atacado/Varejo) indisponíveis na data do pedido — comissão proporcional indisponível.",
          ],
        });
        byItemId.set(item.id, unavailable);
        itemPayloads.push(unavailable);
        continue;
      }
      if (!tiersResult.ok) {
        const unavailable = unavailableCommercialMarginItem({
          soldQuantity,
          negotiatedUnitPrice,
          soldValue: soldValuePreview,
          referenceDate: refIso,
          warnings: [
            "Faixas comerciais (Atacado/Varejo) incompletas na data do pedido — comissão proporcional indisponível.",
          ],
        });
        byItemId.set(item.id, unavailable);
        itemPayloads.push(unavailable);
        continue;
      }

      // Sem snapshot/versão: reconstrói pela tabela ATACADO publicada na data do pedido.
      if (!formation) {
        const atacadoTable = await prisma.priceTable.findFirst({
          where: { code: COMMERCIAL_PRICE_TIER_CODES[0], status: "ACTIVE" },
          select: { id: true },
        });
        if (atacadoTable) {
          formation = await reconstructFormationAtOrderDate(
            prisma,
            atacadoTable.id,
            item.productId,
            referenceDate!
          );
        }
      }

      if (!formation) {
        const unavailable = unavailableCommercialMarginItem({
          soldQuantity,
          negotiatedUnitPrice,
          soldValue: soldValuePreview,
          referenceDate: refIso,
          warnings: [
            "Margem comercial indisponível. Não foi possível identificar a formação de preço utilizada nesta venda.",
          ],
        });
        byItemId.set(item.id, unavailable);
        itemPayloads.push(unavailable);
        continue;
      }

      const tierResolution = resolveCommercialPriceTier({
        soldUnitPrice: negotiatedUnitPrice,
        tiers: tiersResult.tiers,
      });
      if (!tierResolution.ok) {
        const unavailable = unavailableCommercialMarginItem({
          soldQuantity,
          negotiatedUnitPrice,
          soldValue: soldValuePreview,
          referenceDate: refIso,
          warnings: [tierResolution.message],
        });
        byItemId.set(item.id, unavailable);
        itemPayloads.push(unavailable);
        continue;
      }

      const commissionRate = tierResolution.ratePercent / 100;
      const interpolation = tierResolution.interpolation;
      const payload = calculateSalesOrderItemCommercialMargin({
        soldQuantity,
        negotiatedUnitPrice,
        frozenTotalCost: formation.frozenTotalCost,
        rates: {
          taxRate: formation.taxRate,
          commissionRate,
          otherRate: formation.otherRate,
          freightRate: formation.freightRate,
          freight: formation.freightAbs,
        },
        calculationSource: formation.source,
        priceTableVersionId: formation.priceTableVersionId,
        referenceDate: refIso,
        lowerMarginBand: bandLabelFromCode(
          interpolation?.fromTierCode ?? tierResolution.tierCode
        ),
        upperMarginBand: bandLabelFromCode(
          interpolation?.toTierCode ?? tierResolution.tierCode
        ),
        lowerBandPrice: interpolation?.fromSalePrice ?? null,
        upperBandPrice: interpolation?.toSalePrice ?? null,
        warnings: [
          ...formation.warnings,
          ...(tierResolution.outOfTablePrice
            ? ["Preço abaixo da menor faixa — comissão fora de tabela."]
            : []),
        ],
      });

      byItemId.set(item.id, payload);
      itemPayloads.push(payload);
    }

    result.set(order.id, {
      summary: summarizeSalesOrderCommercialMargins(itemPayloads, {
        totalActiveSoldValue,
      }),
      byItemId,
    });
  }

  return result;
}

// re-export for tests that mock tiers
export { loadCommercialPriceTiersForProduct };
export type { CommercialPriceTierRow };
