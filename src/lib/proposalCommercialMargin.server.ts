/**
 * Adapter server-only — margem comercial da Proposta.
 * Autoridade no save: não confia em margem/comissão enviadas pelo frontend.
 * Independente do adapter de Pedido de Venda.
 */
import type { PrismaClient } from "@prisma/client";
import {
  COMMERCIAL_PRICE_TIER_CODES,
  type CommercialPriceTierCode,
} from "./commissions/commission-commercial-tier.js";
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  calculateProposalItemCommercialMargin,
  readExplicitAbsolute,
  readExplicitRate,
  type ProposalCommercialMarginItemPayload,
  type ProposalCommercialMarginReasonCode,
} from "./proposalCommercialMargin.js";
import {
  buildProposalCommercialMarginFreeze,
  recalculateProposalCommercialMarginFromFrozenFormation,
  serializeProposalCommercialPricingSnapshot,
  toProposalCommercialPricingSnapshot,
  type ProposalCommercialMarginFreeze,
  type ProposalCommercialPricingSnapshot,
  parseProposalCommercialPricingSnapshot,
} from "./proposalCommercialMarginSnapshot.js";

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

export type ProposalCommercialFormation = {
  ok: true;
  formationContextId: string;
  referenceDate: string;
  frozenCostUnit: number;
  taxRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
  otherVariablesRate: number;
  tiers: CommercialMarginTier[];
  priceTableIdByTierId: Record<string, string>;
  priceTableVersionIdByTierId: Record<string, string>;
};

export type ProposalCommercialFormationFailure = {
  ok: false;
  reasonCode: ProposalCommercialMarginReasonCode;
  message: string;
};

export type ProposalCommercialFormationResult =
  | ProposalCommercialFormation
  | ProposalCommercialFormationFailure;

type LoadedItem = {
  priceTableVersionId: string;
  productId: string;
  frozenTotalCost: unknown;
  marginPct: unknown;
  salePrice: unknown;
  commissionPerc: unknown;
  formulaSnapshotJson: unknown;
};

function extractRates(item: LoadedItem): {
  ok: true;
  frozenCostUnit: number;
  taxRate: number;
  otherRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
} | { ok: false; reasonCode: ProposalCommercialMarginReasonCode; message: string } {
  const cost = toNum(item.frozenTotalCost);
  if (cost == null || cost <= 0) {
    return { ok: false, reasonCode: "COST_NOT_FOUND", message: "Custo de formação ausente." };
  }
  const formula = asRecord(item.formulaSnapshotJson);
  const rates = asRecord(formula?.rates);
  if (!formula || !rates) {
    return {
      ok: false,
      reasonCode: "PRODUCT_WITHOUT_PRICE_FORMATION",
      message: "Produto sem formação de preço cadastrada.",
    };
  }
  const tax = readExplicitRate(rates.taxRate);
  const other = readExplicitRate(rates.otherRate);
  if (!tax.present) return { ok: false, reasonCode: "TAX_NOT_FOUND", message: "Imposto ausente." };
  if (!other.present) {
    return { ok: false, reasonCode: "OTHER_VARIABLES_NOT_DEFINED", message: "Outras variáveis ausentes." };
  }
  let freightRate: number | null = null;
  const fr = readExplicitRate(rates.freightRate);
  if (fr.present) freightRate = fr.value;
  else {
    const fp = readExplicitAbsolute(formula.freightPercent);
    if (fp.present) freightRate = fp.value / 100;
  }
  const freightAbs = readExplicitAbsolute(formula.freight);
  if (freightRate == null || !freightAbs.present) {
    return { ok: false, reasonCode: "FREIGHT_NOT_DEFINED", message: "Frete da formação ausente." };
  }
  return {
    ok: true,
    frozenCostUnit: cost,
    taxRate: tax.value,
    otherRate: other.value,
    freightRate,
    freightAbsoluteUnit: freightAbs.value,
  };
}

/**
 * Carrega faixas comerciais vigentes na data (batch, sem N+1 por item).
 * Quantidade de faixas = tabelas comerciais ativas com item do produto.
 */
export async function loadProposalCommercialFormationsBatch(
  db: PrismaClient,
  productIds: string[],
  referenceDate: Date
): Promise<Map<string, ProposalCommercialFormationResult>> {
  const result = new Map<string, ProposalCommercialFormationResult>();
  const unique = [...new Set(productIds.filter(Boolean))];
  const refIso = toCivilDateKey(referenceDate);
  if (!refIso) {
    for (const id of unique) {
      result.set(id, {
        ok: false,
        reasonCode: "HISTORICAL_FORMATION_NOT_FOUND",
        message: "Data de referência inválida.",
      });
    }
    return result;
  }
  if (unique.length === 0) return result;

  const tables = await db.priceTable.findMany({
    where: { code: { in: [...COMMERCIAL_PRICE_TIER_CODES] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });
  if (tables.length < 2) {
    for (const id of unique) {
      result.set(id, {
        ok: false,
        reasonCode: "INCOMPLETE_MARGIN_TIERS",
        message: "Faixas comerciais insuficientes cadastradas.",
      });
    }
    return result;
  }

  const versionIdsByCode = new Map<CommercialPriceTierCode, string>();
  const versionIdToCode = new Map<string, CommercialPriceTierCode>();
  const tableByCode = new Map(tables.map((t) => [t.code as CommercialPriceTierCode, t]));

  for (const table of tables) {
    const code = table.code as CommercialPriceTierCode;
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
    if (overlapping.length === 0) continue;
    if (overlapping.length > 1) {
      for (const id of unique) {
        result.set(id, {
          ok: false,
          reasonCode: "HISTORICAL_FORMATION_AMBIGUOUS",
          message: `Formação ambígua em ${code} para a data.`,
        });
      }
      return result;
    }
    versionIdsByCode.set(code, overlapping[0]!.id);
    versionIdToCode.set(overlapping[0]!.id, code);
  }

  if (versionIdsByCode.size < 2) {
    for (const id of unique) {
      result.set(id, {
        ok: false,
        reasonCode: "INCOMPLETE_MARGIN_TIERS",
        message: "Faixas incompletas na data de referência.",
      });
    }
    return result;
  }

  const versionIds = [...versionIdsByCode.values()];
  const formationContextId = versionIds.slice().sort().join("|");

  const items = await db.priceTableItem.findMany({
    where: {
      priceTableVersionId: { in: versionIds },
      productId: { in: unique },
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

  const byProduct = new Map<string, Map<CommercialPriceTierCode, LoadedItem>>();
  for (const item of items) {
    const code = versionIdToCode.get(item.priceTableVersionId);
    if (!code) continue;
    let map = byProduct.get(item.productId);
    if (!map) {
      map = new Map();
      byProduct.set(item.productId, map);
    }
    map.set(code, item);
  }

  for (const productId of unique) {
    const byCode = byProduct.get(productId);
    if (!byCode || byCode.size < 2) {
      result.set(productId, {
        ok: false,
        reasonCode:
          !byCode || byCode.size === 0
            ? "PRODUCT_WITHOUT_PRICE_FORMATION"
            : "INCOMPLETE_MARGIN_TIERS",
        message:
          !byCode || byCode.size === 0
            ? "Produto sem formação de preço cadastrada."
            : "Faixas incompletas para o produto.",
      });
      continue;
    }

    const tiers: CommercialMarginTier[] = [];
    const priceTableIdByTierId: Record<string, string> = {};
    const priceTableVersionIdByTierId: Record<string, string> = {};
    let anchor: ReturnType<typeof extractRates> | null = null;
    let failed: ProposalCommercialFormationFailure | null = null;

    for (const code of COMMERCIAL_PRICE_TIER_CODES) {
      const item = byCode.get(code);
      if (!item) continue;
      const salePrice = toNum(item.salePrice);
      const commissionPercent = toNum(item.commissionPerc);
      const marginPct = toNum(item.marginPct);
      if (salePrice == null || salePrice <= 0 || commissionPercent == null || commissionPercent < 0) {
        failed = {
          ok: false,
          reasonCode: "INCOMPLETE_MARGIN_TIERS",
          message: `Faixa ${code} incompleta.`,
        };
        break;
      }
      const extracted = extractRates(item);
      if (!extracted.ok) {
        failed = extracted;
        break;
      }
      if (!anchor) anchor = extracted;
      else if (
        Math.abs(anchor.frozenCostUnit - extracted.frozenCostUnit) > 1e-6 ||
        Math.abs(anchor.taxRate - extracted.taxRate) > 1e-9 ||
        Math.abs(anchor.otherRate - extracted.otherRate) > 1e-9 ||
        Math.abs(anchor.freightRate - extracted.freightRate) > 1e-9 ||
        Math.abs(anchor.freightAbsoluteUnit - extracted.freightAbsoluteUnit) > 1e-6
      ) {
        failed = {
          ok: false,
          reasonCode: "INCONSISTENT_PRICE_FORMATION_SET",
          message: "Faixas com formação inconsistente.",
        };
        break;
      }
      const table = tableByCode.get(code)!;
      const tierId = code;
      tiers.push({
        id: tierId,
        marginRate: (marginPct ?? 0) > 1 ? (marginPct ?? 0) / 100 : marginPct ?? 0,
        salePrice,
        commissionRate: commissionPercent > 1 ? commissionPercent / 100 : commissionPercent,
      });
      priceTableIdByTierId[tierId] = table.id;
      priceTableVersionIdByTierId[tierId] = item.priceTableVersionId;
    }

    if (failed || !anchor || tiers.length < 2) {
      result.set(
        productId,
        failed ?? {
          ok: false,
          reasonCode: "INCOMPLETE_MARGIN_TIERS",
          message: "Faixas incompletas.",
        }
      );
      continue;
    }

    tiers.sort((a, b) => a.salePrice - b.salePrice);
    result.set(productId, {
      ok: true,
      formationContextId,
      referenceDate: refIso,
      frozenCostUnit: anchor.frozenCostUnit,
      taxRate: anchor.taxRate,
      freightRate: anchor.freightRate,
      freightAbsoluteUnit: anchor.freightAbsoluteUnit,
      otherVariablesRate: anchor.otherRate,
      tiers,
      priceTableIdByTierId,
      priceTableVersionIdByTierId,
    });
  }

  return result;
}

function snapshotToFreeze(
  snapshot: ProposalCommercialPricingSnapshot,
  quantity: number,
  productId: string | null
): ProposalCommercialMarginFreeze {
  return {
    schemaVersion: 1,
    formationContextId: snapshot.formationContextId,
    priceTableId: snapshot.priceTableId,
    priceTableVersionId: snapshot.priceTableVersionId,
    referenceDate: snapshot.referenceDate,
    productId,
    quantity,
    referenceTableUnitPrice: snapshot.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: snapshot.negotiatedGrossUnitPrice,
    informedDiscountRate: snapshot.informedDiscountRate,
    informedDiscountValue: snapshot.informedDiscountValue,
    finalNetUnitPrice: snapshot.finalNetUnitPrice,
    finalNetLineValue: snapshot.finalNetLineValue,
    frozenCostUnit: snapshot.frozenCostUnit,
    taxRate: snapshot.taxRate,
    freightRate: snapshot.freightRate,
    freightAbsoluteUnit: snapshot.freightAbsoluteUnit,
    otherVariablesRate: snapshot.otherVariablesRate,
    tiers: snapshot.tiers,
    calculatedCommissionRate: snapshot.calculatedCommissionRate,
    commercialMarginRate: snapshot.commercialMarginRate,
    commercialMarginValue: snapshot.commercialMarginValue,
    warnings: snapshot.warnings,
    calculationSource: snapshot.calculationSource,
    reasonCode: null,
    capturedAt: new Date().toISOString(),
  };
}

function buildSnapshotFromFormation(input: {
  formation: ProposalCommercialFormation;
  productId: string | null;
  quantity: number;
  suggested: number | null;
  negotiated: number;
  discountPerc: number | null;
  discountValue: number | null;
  priceTableId: string | null;
  priceTableVersionId: string | null;
}): ProposalCommercialPricingSnapshot {
  const marginItem = calculateProposalItemCommercialMargin({
    quantity: input.quantity,
    referenceTableUnitPrice: input.suggested,
    negotiatedGrossUnitPrice: input.negotiated,
    informedDiscountRate:
      input.discountPerc != null ? input.discountPerc / 100 : null,
    informedDiscountValue: input.discountValue,
    frozenCostUnit: input.formation.frozenCostUnit,
    taxRate: input.formation.taxRate,
    freightRate: input.formation.freightRate,
    freightAbsoluteUnit: input.formation.freightAbsoluteUnit,
    otherVariablesRate: input.formation.otherVariablesRate,
    tiers: input.formation.tiers,
    formationContextId: input.formation.formationContextId,
    referenceDate: input.formation.referenceDate,
  });

  const freeze = buildProposalCommercialMarginFreeze({
    formationContextId: input.formation.formationContextId,
    priceTableId: input.priceTableId,
    priceTableVersionId: input.priceTableVersionId,
    referenceDate: input.formation.referenceDate,
    productId: input.productId,
    marginItem,
    frozenCostUnit: { presence: "value", value: input.formation.frozenCostUnit },
    taxRate: { presence: "value", value: input.formation.taxRate },
    freightRate: { presence: "value", value: input.formation.freightRate },
    freightAbsoluteUnit: {
      presence: "value",
      value: input.formation.freightAbsoluteUnit,
    },
    otherVariablesRate: {
      presence: "value",
      value: input.formation.otherVariablesRate,
    },
    informedDiscountRate:
      input.discountPerc == null
        ? { presence: "null" }
        : { presence: "value", value: input.discountPerc / 100 },
    informedDiscountValue:
      input.discountValue == null
        ? { presence: "null" }
        : { presence: "value", value: input.discountValue },
    tiers: input.formation.tiers,
  });

  return toProposalCommercialPricingSnapshot(freeze);
}

/**
 * Recalcula e persiste snapshot comercial oficial nos itens.
 * Aceita do frontend apenas qty/preço/desconto/tabela.
 * Formação e resultados vêm do motor + histórico no banco (ou freeze já validado).
 */
export async function stampProposalItemsWithCommercialMarginsForWrite(
  db: PrismaClient,
  items: Array<Record<string, unknown>>,
  options?: { referenceDate?: Date | string | null }
): Promise<Array<Record<string, unknown>>> {
  const defaultRefRaw = options?.referenceDate;
  const defaultRef =
    defaultRefRaw instanceof Date
      ? defaultRefRaw
      : defaultRefRaw
        ? new Date(defaultRefRaw)
        : new Date();
  const defaultRefOk = Number.isFinite(defaultRef.getTime()) ? defaultRef : new Date();

  // Agrupa produtos por data de formação (freeze.referenceDate ou default).
  const groups = new Map<string, { date: Date; productIds: Set<string> }>();
  const defaultKey = toCivilDateKey(defaultRefOk)!;
  for (const raw of items) {
    const productId = typeof raw.productId === "string" ? raw.productId : "";
    if (!productId) continue;
    const parsed = parseProposalCommercialPricingSnapshot(raw.commercialPricingSnapshotJson);
    const dateStr = parsed?.referenceDate;
    const date =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(`${dateStr}T12:00:00`)
        : defaultRefOk;
    const key = toCivilDateKey(date) ?? defaultKey;
    let group = groups.get(key);
    if (!group) {
      group = { date, productIds: new Set() };
      groups.set(key, group);
    }
    group.productIds.add(productId);
  }

  // Sempre carrega também a data default (hoje/proposta) — fallback quando a
  // data congelada não tem formação (paridade com hydrate do formulário).
  if (groups.size > 0) {
    let defaultGroup = groups.get(defaultKey);
    if (!defaultGroup) {
      defaultGroup = { date: defaultRefOk, productIds: new Set() };
      groups.set(defaultKey, defaultGroup);
    }
    for (const [key, group] of groups) {
      if (key === defaultKey) continue;
      for (const productId of group.productIds) defaultGroup.productIds.add(productId);
    }
  }

  const formationsByDate = new Map<string, Map<string, ProposalCommercialFormationResult>>();
  for (const [key, group] of groups) {
    formationsByDate.set(
      key,
      await loadProposalCommercialFormationsBatch(db, [...group.productIds], group.date)
    );
  }

  return items.map((raw) => {
    const item = { ...raw };
    delete item.commercialMarginRate;
    delete item.commercialMarginPercent;
    delete item.commercialMarginValue;
    delete item.calculatedCommissionRate;
    delete item.commissionRate;
    const clientSnapshot = item.commercialPricingSnapshotJson;
    delete item.commercialPricingSnapshotJson;

    const productId = typeof item.productId === "string" ? item.productId : "";
    const quantity = toNum(item.quantity) ?? 0;
    const negotiated = toNum(item.negotiatedPrice) ?? 0;
    const suggested = toNum(item.suggestedPrice);
    const discountPerc = toNum(item.discountPerc);
    const discountValue = toNum(item.discountValue);
    const priceTableId = typeof item.priceTableId === "string" ? item.priceTableId : null;
    const priceTableVersionId =
      typeof item.priceTableVersionId === "string" ? item.priceTableVersionId : null;

    const existing = parseProposalCommercialPricingSnapshot(clientSnapshot);
    const dateKey =
      existing?.referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(existing.referenceDate)
        ? existing.referenceDate
        : defaultKey;
    let formation = formationsByDate.get(dateKey)?.get(productId);
    if ((!formation || !formation.ok) && dateKey !== defaultKey) {
      formation = formationsByDate.get(defaultKey)?.get(productId);
    }

    // Formação autoritativa do banco na data congelada/proposta.
    if (formation?.ok) {
      const snapshot = buildSnapshotFromFormation({
        formation,
        productId: productId || null,
        quantity,
        suggested,
        negotiated,
        discountPerc,
        discountValue,
        priceTableId: priceTableId ?? existing?.priceTableId ?? null,
        priceTableVersionId: priceTableVersionId ?? existing?.priceTableVersionId ?? null,
      });
      item.commercialPricingSnapshotJson =
        serializeProposalCommercialPricingSnapshot(snapshot);
      return item;
    }

    // Fallback: recalcular só derivados a partir do freeze já persistido (sem DB).
    if (existing && existing.tiers.length >= 2 && existing.frozenCostUnit != null) {
      const { freeze } = recalculateProposalCommercialMarginFromFrozenFormation({
        freeze: snapshotToFreeze(existing, quantity, productId || null),
        quantity,
        negotiatedGrossUnitPrice: negotiated,
        informedDiscountRate:
          discountPerc != null ? discountPerc / 100 : existing.informedDiscountRate,
        informedDiscountValue: discountValue,
        referenceTableUnitPrice: suggested ?? existing.referenceTableUnitPrice,
      });
      item.commercialPricingSnapshotJson = serializeProposalCommercialPricingSnapshot(
        toProposalCommercialPricingSnapshot(freeze)
      );
      return item;
    }

    item.commercialPricingSnapshotJson = null;
    return item;
  });
}

export type { ProposalCommercialMarginItemPayload };
