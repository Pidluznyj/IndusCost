/**
 * Persistência histórica da margem comercial da Proposta.
 *
 * Usa campos existentes:
 * - colunas de ProposalItem (preço, desconto, qty, priceTable*)
 * - `pricingSnapshotJson.commercialMarginFreeze` (namespace aditivo)
 *
 * Sem migration. Não altera o root publicado (item/proposalDefaults/formulaSnapshotJson).
 * Zero explícito, null e chave ausente são distintos na leitura.
 */
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import {
  calculateProposalItemCommercialMargin,
  type ProposalCommercialMarginItemPayload,
  type ProposalCommercialMarginReasonCode,
  type ProposalCommercialMarginSource,
} from "./proposalCommercialMargin.js";

export const PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY = "commercialMarginFreeze" as const;
export const PROPOSAL_COMMERCIAL_MARGIN_FREEZE_SCHEMA_VERSION = 1 as const;

export const PROPOSAL_COMMERCIAL_MARGIN_UPDATE_TO_CURRENT_TABLE_ACTION =
  "Atualizar item para a tabela vigente" as const;

export type ProposalCommercialMarginFreezeTier = {
  tierId: string;
  marginRate: number;
  salePrice: number;
  commissionRate: number;
};

/**
 * Freeze mínimo por item — formação + resultados derivados.
 * Taxas em fração. `null` explícito ≠ chave ausente ≠ zero.
 */
export type ProposalCommercialMarginFreeze = {
  schemaVersion: typeof PROPOSAL_COMMERCIAL_MARGIN_FREEZE_SCHEMA_VERSION;
  formationContextId: string | null;
  priceTableId: string | null;
  priceTableVersionId: string | null;
  referenceDate: string | null;

  productId: string | null;
  quantity: number;

  referenceTableUnitPrice: number | null;
  negotiatedGrossUnitPrice: number | null;

  informedDiscountRate: number | null;
  informedDiscountValue: number | null;

  finalNetUnitPrice: number | null;
  finalNetLineValue: number | null;

  frozenCostUnit: number | null;
  taxRate: number | null;
  freightRate: number | null;
  freightAbsoluteUnit: number | null;
  otherVariablesRate: number | null;

  tiers: ProposalCommercialMarginFreezeTier[];

  calculatedCommissionRate: number | null;
  commercialMarginRate: number | null;
  commercialMarginValue: number | null;

  warnings: string[];
  calculationSource: ProposalCommercialMarginSource;
  reasonCode: ProposalCommercialMarginReasonCode | null;
  capturedAt: string;
};

export type ExplicitNumberPresence =
  | { presence: "absent" }
  | { presence: "null" }
  | { presence: "value"; value: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Distingue chave ausente / null / número (inclui 0). */
export function readExplicitNumberField(
  record: Record<string, unknown> | null | undefined,
  key: string
): ExplicitNumberPresence {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return { presence: "absent" };
  }
  const raw = record[key];
  if (raw === null) return { presence: "null" };
  const n = toFiniteNumber(raw);
  if (n == null) return { presence: "null" };
  return { presence: "value", value: n };
}

export function explicitNumberToStored(
  presence: ExplicitNumberPresence
): number | null | undefined {
  if (presence.presence === "absent") return undefined;
  if (presence.presence === "null") return null;
  return presence.value;
}

function normalizeTier(raw: unknown): ProposalCommercialMarginFreezeTier | null {
  if (!isPlainObject(raw)) return null;
  const tierId =
    typeof raw.tierId === "string" && raw.tierId.trim()
      ? raw.tierId.trim()
      : typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : "";
  const marginRate = toFiniteNumber(raw.marginRate);
  const salePrice = toFiniteNumber(raw.salePrice);
  const commissionRate = toFiniteNumber(raw.commissionRate);
  if (!tierId || marginRate == null || salePrice == null || commissionRate == null) {
    return null;
  }
  if (!(salePrice > 0) || commissionRate < 0) return null;
  return { tierId, marginRate, salePrice, commissionRate };
}

export function freezeTiersToCommercialMarginTiers(
  tiers: ReadonlyArray<ProposalCommercialMarginFreezeTier>
): CommercialMarginTier[] {
  return tiers.map((t) => ({
    id: t.tierId,
    marginRate: t.marginRate,
    salePrice: t.salePrice,
    commissionRate: t.commissionRate,
  }));
}

export function commercialMarginTiersToFreezeTiers(
  tiers: ReadonlyArray<CommercialMarginTier>
): ProposalCommercialMarginFreezeTier[] {
  return tiers.map((t) => ({
    tierId: t.id,
    marginRate: t.marginRate,
    salePrice: t.salePrice,
    commissionRate: t.commissionRate,
  }));
}

export type BuildProposalCommercialMarginFreezeInput = {
  formationContextId?: string | null;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  referenceDate?: string | null;
  productId?: string | null;
  /** Resultado do motor (completo ou unavailable). */
  marginItem: ProposalCommercialMarginItemPayload;
  /**
   * Taxas/custo usados na formação — presença explícita.
   * Preferir estes sobre o payload quando o motor falhou parcialmente.
   */
  frozenCostUnit?: ExplicitNumberPresence;
  taxRate?: ExplicitNumberPresence;
  freightRate?: ExplicitNumberPresence;
  freightAbsoluteUnit?: ExplicitNumberPresence;
  otherVariablesRate?: ExplicitNumberPresence;
  tiers?: ReadonlyArray<CommercialMarginTier> | ReadonlyArray<ProposalCommercialMarginFreezeTier>;
  informedDiscountRate?: ExplicitNumberPresence;
  informedDiscountValue?: ExplicitNumberPresence;
  capturedAt?: string;
};

function resolveStoredRate(
  override: ExplicitNumberPresence | undefined,
  fallback: number | null | undefined
): number | null {
  if (override) {
    if (override.presence === "absent") return null;
    if (override.presence === "null") return null;
    return override.value;
  }
  return fallback ?? null;
}

/**
 * Monta o freeze a partir do motor + inputs de formação.
 * Sempre serializa as chaves do contrato (null quando não houver valor).
 */
export function buildProposalCommercialMarginFreeze(
  input: BuildProposalCommercialMarginFreezeInput
): ProposalCommercialMarginFreeze {
  const item = input.marginItem;
  const rawTiers = input.tiers ?? [];
  const tiers: ProposalCommercialMarginFreezeTier[] = [];
  for (const t of rawTiers) {
    if ("tierId" in t && typeof (t as ProposalCommercialMarginFreezeTier).tierId === "string") {
      const n = normalizeTier(t);
      if (n) tiers.push(n);
    } else {
      const cm = t as CommercialMarginTier;
      tiers.push({
        tierId: cm.id,
        marginRate: cm.marginRate,
        salePrice: cm.salePrice,
        commissionRate: cm.commissionRate,
      });
    }
  }

  return {
    schemaVersion: PROPOSAL_COMMERCIAL_MARGIN_FREEZE_SCHEMA_VERSION,
    formationContextId: input.formationContextId ?? item.formationContextId ?? null,
    priceTableId: input.priceTableId ?? null,
    priceTableVersionId: input.priceTableVersionId ?? null,
    referenceDate: input.referenceDate ?? item.referenceDate ?? null,
    productId: input.productId ?? null,
    quantity: item.quantity,
    referenceTableUnitPrice: item.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: item.negotiatedGrossUnitPrice,
    informedDiscountRate: resolveStoredRate(input.informedDiscountRate, null),
    informedDiscountValue: resolveStoredRate(input.informedDiscountValue, null),
    finalNetUnitPrice: item.finalNetUnitPrice,
    finalNetLineValue: item.finalNetLineValue,
    frozenCostUnit: resolveStoredRate(input.frozenCostUnit, item.costUnit),
    taxRate: resolveStoredRate(input.taxRate, item.taxRate),
    freightRate: resolveStoredRate(input.freightRate, item.freightRate),
    freightAbsoluteUnit: resolveStoredRate(
      input.freightAbsoluteUnit,
      item.freightAbsoluteUnit
    ),
    otherVariablesRate: resolveStoredRate(
      input.otherVariablesRate,
      item.otherVariablesRate
    ),
    tiers,
    calculatedCommissionRate: item.commissionRate,
    commercialMarginRate: item.commercialMarginRate,
    commercialMarginValue: item.commercialMarginValue,
    warnings: [...item.warnings],
    calculationSource: item.calculationSource,
    reasonCode: item.reasonCode,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

/**
 * Lê o freeze do snapshot. Retorna null se o namespace estiver ausente
 * (Proposta antiga sem freeze — não inventa zeros).
 */
export function readProposalCommercialMarginFreeze(
  pricingSnapshotJson: unknown
): ProposalCommercialMarginFreeze | null {
  if (!isPlainObject(pricingSnapshotJson)) return null;
  if (
    !Object.prototype.hasOwnProperty.call(
      pricingSnapshotJson,
      PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY
    )
  ) {
    return null;
  }
  const raw = pricingSnapshotJson[PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY];
  if (raw === null) return null;
  if (!isPlainObject(raw)) return null;

  const tiersRaw = Array.isArray(raw.tiers) ? raw.tiers : [];
  const tiers: ProposalCommercialMarginFreezeTier[] = [];
  for (const t of tiersRaw) {
    const n = normalizeTier(t);
    if (n) tiers.push(n);
  }

  const readNum = (key: string): number | null => {
    const p = readExplicitNumberField(raw, key);
    if (p.presence === "value") return p.value;
    return null;
  };

  const quantity = readNum("quantity");
  if (quantity == null || !(quantity >= 0)) return null;

  const calculationSource =
    raw.calculationSource === "PROPOSAL_PRICE_FORMATION" ||
    raw.calculationSource === "UNAVAILABLE"
      ? raw.calculationSource
      : "UNAVAILABLE";

  return {
    schemaVersion: PROPOSAL_COMMERCIAL_MARGIN_FREEZE_SCHEMA_VERSION,
    formationContextId:
      typeof raw.formationContextId === "string" ? raw.formationContextId : null,
    priceTableId: typeof raw.priceTableId === "string" ? raw.priceTableId : null,
    priceTableVersionId:
      typeof raw.priceTableVersionId === "string" ? raw.priceTableVersionId : null,
    referenceDate: typeof raw.referenceDate === "string" ? raw.referenceDate : null,
    productId: typeof raw.productId === "string" ? raw.productId : null,
    quantity,
    referenceTableUnitPrice: readNum("referenceTableUnitPrice"),
    negotiatedGrossUnitPrice: readNum("negotiatedGrossUnitPrice"),
    informedDiscountRate: readNum("informedDiscountRate"),
    informedDiscountValue: readNum("informedDiscountValue"),
    finalNetUnitPrice: readNum("finalNetUnitPrice"),
    finalNetLineValue: readNum("finalNetLineValue"),
    frozenCostUnit: readNum("frozenCostUnit"),
    taxRate: readNum("taxRate"),
    freightRate: readNum("freightRate"),
    freightAbsoluteUnit: readNum("freightAbsoluteUnit"),
    otherVariablesRate: readNum("otherVariablesRate"),
    tiers,
    calculatedCommissionRate: readNum("calculatedCommissionRate"),
    commercialMarginRate: readNum("commercialMarginRate"),
    commercialMarginValue: readNum("commercialMarginValue"),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((w): w is string => typeof w === "string")
      : [],
    calculationSource,
    reasonCode:
      typeof raw.reasonCode === "string"
        ? (raw.reasonCode as ProposalCommercialMarginReasonCode)
        : null,
    capturedAt:
      typeof raw.capturedAt === "string" ? raw.capturedAt : new Date(0).toISOString(),
  };
}

/**
 * Mescla o freeze no snapshot existente sem remover o payload publicado.
 */
export function mergeCommercialMarginFreezeIntoPricingSnapshot(
  pricingSnapshotJson: unknown,
  freeze: ProposalCommercialMarginFreeze
): Record<string, unknown> {
  const base = isPlainObject(pricingSnapshotJson) ? { ...pricingSnapshotJson } : {};
  base[PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY] = freeze;
  return base;
}

/**
 * Reabertura histórica: recalcula derivados com a formação congelada.
 * Não troca versão/tabela/faixas.
 */
export function recalculateProposalCommercialMarginFromFrozenFormation(input: {
  freeze: ProposalCommercialMarginFreeze;
  quantity: number;
  negotiatedGrossUnitPrice: number;
  informedDiscountRate?: number | null;
  informedDiscountValue?: number | null;
  referenceTableUnitPrice?: number | null;
}): {
  marginItem: ProposalCommercialMarginItemPayload;
  freeze: ProposalCommercialMarginFreeze;
} {
  const f = input.freeze;
  // Preferência: inputs novos do usuário. Se só a taxa muda, não reaplicar
  // informedDiscountValue=0 congelado (zero explícito antigo) por cima da taxa nova.
  const discountRate =
    input.informedDiscountRate !== undefined
      ? input.informedDiscountRate
      : f.informedDiscountRate;
  const discountValue =
    input.informedDiscountValue !== undefined
      ? input.informedDiscountValue
      : input.informedDiscountRate !== undefined
        ? null
        : f.informedDiscountValue;

  const marginItem = calculateProposalItemCommercialMargin({
    quantity: input.quantity,
    referenceTableUnitPrice:
      input.referenceTableUnitPrice ?? f.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: input.negotiatedGrossUnitPrice,
    informedDiscountRate: discountRate,
    informedDiscountValue: discountValue,
    frozenCostUnit: f.frozenCostUnit,
    taxRate: f.taxRate,
    freightRate: f.freightRate,
    freightAbsoluteUnit: f.freightAbsoluteUnit,
    otherVariablesRate: f.otherVariablesRate,
    tiers: freezeTiersToCommercialMarginTiers(f.tiers),
    formationContextId: f.formationContextId,
    referenceDate: f.referenceDate,
  });

  const nextFreeze = buildProposalCommercialMarginFreeze({
    formationContextId: f.formationContextId,
    priceTableId: f.priceTableId,
    priceTableVersionId: f.priceTableVersionId,
    referenceDate: f.referenceDate,
    productId: f.productId,
    marginItem,
    frozenCostUnit:
      f.frozenCostUnit == null
        ? { presence: "null" }
        : { presence: "value", value: f.frozenCostUnit },
    taxRate:
      f.taxRate == null ? { presence: "null" } : { presence: "value", value: f.taxRate },
    freightRate:
      f.freightRate == null
        ? { presence: "null" }
        : { presence: "value", value: f.freightRate },
    freightAbsoluteUnit:
      f.freightAbsoluteUnit == null
        ? { presence: "null" }
        : { presence: "value", value: f.freightAbsoluteUnit },
    otherVariablesRate:
      f.otherVariablesRate == null
        ? { presence: "null" }
        : { presence: "value", value: f.otherVariablesRate },
    informedDiscountRate:
      discountRate == null
        ? { presence: "null" }
        : { presence: "value", value: discountRate },
    informedDiscountValue:
      discountValue == null
        ? { presence: "null" }
        : { presence: "value", value: discountValue },
    tiers: f.tiers,
    capturedAt: f.capturedAt,
  });

  return { marginItem, freeze: nextFreeze };
}

export type ProposalUpdateToCurrentTableComparison = {
  actionLabel: typeof PROPOSAL_COMMERCIAL_MARGIN_UPDATE_TO_CURRENT_TABLE_ACTION;
  requiresConfirmation: true;
  silentUpdateForbidden: true;
  current: {
    priceTableId: string | null;
    priceTableVersionId: string | null;
    formationContextId: string | null;
    referenceTableUnitPrice: number | null;
    negotiatedGrossUnitPrice: number | null;
    commercialMarginRate: number | null;
    commercialMarginValue: number | null;
    calculatedCommissionRate: number | null;
  };
  proposed: {
    priceTableId: string | null;
    priceTableVersionId: string | null;
    formationContextId: string | null;
    referenceTableUnitPrice: number | null;
    negotiatedGrossUnitPrice: number | null;
    commercialMarginRate: number | null;
    commercialMarginValue: number | null;
    calculatedCommissionRate: number | null;
  };
  changedFields: string[];
};

/**
 * Ação explícita "Atualizar item para a tabela vigente".
 * Domínio puro: comparação + flag de confirmação. Não aplica silenciosamente.
 */
export function buildUpdateProposalItemToCurrentTableComparison(input: {
  currentFreeze: ProposalCommercialMarginFreeze | null;
  proposedFreeze: ProposalCommercialMarginFreeze;
}): ProposalUpdateToCurrentTableComparison {
  const cur = input.currentFreeze;
  const next = input.proposedFreeze;
  const changedFields: string[] = [];
  const pairs: Array<[string, unknown, unknown]> = [
    ["priceTableId", cur?.priceTableId ?? null, next.priceTableId],
    ["priceTableVersionId", cur?.priceTableVersionId ?? null, next.priceTableVersionId],
    ["formationContextId", cur?.formationContextId ?? null, next.formationContextId],
    [
      "referenceTableUnitPrice",
      cur?.referenceTableUnitPrice ?? null,
      next.referenceTableUnitPrice,
    ],
    [
      "negotiatedGrossUnitPrice",
      cur?.negotiatedGrossUnitPrice ?? null,
      next.negotiatedGrossUnitPrice,
    ],
    ["commercialMarginRate", cur?.commercialMarginRate ?? null, next.commercialMarginRate],
    ["commercialMarginValue", cur?.commercialMarginValue ?? null, next.commercialMarginValue],
    [
      "calculatedCommissionRate",
      cur?.calculatedCommissionRate ?? null,
      next.calculatedCommissionRate,
    ],
  ];
  for (const [name, a, b] of pairs) {
    if (a !== b) changedFields.push(name);
  }

  return {
    actionLabel: PROPOSAL_COMMERCIAL_MARGIN_UPDATE_TO_CURRENT_TABLE_ACTION,
    requiresConfirmation: true,
    silentUpdateForbidden: true,
    current: {
      priceTableId: cur?.priceTableId ?? null,
      priceTableVersionId: cur?.priceTableVersionId ?? null,
      formationContextId: cur?.formationContextId ?? null,
      referenceTableUnitPrice: cur?.referenceTableUnitPrice ?? null,
      negotiatedGrossUnitPrice: cur?.negotiatedGrossUnitPrice ?? null,
      commercialMarginRate: cur?.commercialMarginRate ?? null,
      commercialMarginValue: cur?.commercialMarginValue ?? null,
      calculatedCommissionRate: cur?.calculatedCommissionRate ?? null,
    },
    proposed: {
      priceTableId: next.priceTableId,
      priceTableVersionId: next.priceTableVersionId,
      formationContextId: next.formationContextId,
      referenceTableUnitPrice: next.referenceTableUnitPrice,
      negotiatedGrossUnitPrice: next.negotiatedGrossUnitPrice,
      commercialMarginRate: next.commercialMarginRate,
      commercialMarginValue: next.commercialMarginValue,
      calculatedCommissionRate: next.calculatedCommissionRate,
    },
    changedFields,
  };
}

/** Entrada pronta para `CommercialAuditLog` (mecanismo oficial existente). */
export type ProposalCommercialMarginAuditEntry = {
  entityType: "ProposalItem";
  entityId: string;
  action: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  performedBy: string | null;
  reason: string | null;
};

/**
 * Monta entradas de auditoria para alteração de preço/desconto/qty/tabela.
 * Persistência via `writeCommercialAuditLog` fica no adapter server (não neste módulo).
 */
export function buildProposalCommercialMarginAuditEntries(input: {
  proposalItemId: string;
  performedBy?: string | null;
  reason?: string | null;
  action:
    | "PROPOSAL_ITEM_PRICE_CHANGE"
    | "PROPOSAL_ITEM_DISCOUNT_CHANGE"
    | "PROPOSAL_ITEM_QUANTITY_CHANGE"
    | "PROPOSAL_ITEM_UPDATE_TO_CURRENT_TABLE"
    | "PROPOSAL_ITEM_COMMERCIAL_MARGIN_RECALC";
  before: Partial<ProposalCommercialMarginFreeze> | null;
  after: Partial<ProposalCommercialMarginFreeze> | null;
  fields?: string[];
}): ProposalCommercialMarginAuditEntry[] {
  const fields =
    input.fields ??
    [
      "quantity",
      "negotiatedGrossUnitPrice",
      "informedDiscountRate",
      "informedDiscountValue",
      "finalNetUnitPrice",
      "finalNetLineValue",
      "calculatedCommissionRate",
      "commercialMarginRate",
      "commercialMarginValue",
      "priceTableVersionId",
      "formationContextId",
    ];
  const entries: ProposalCommercialMarginAuditEntry[] = [];
  for (const fieldName of fields) {
    const oldRaw = input.before
      ? (input.before as Record<string, unknown>)[fieldName]
      : undefined;
    const newRaw = input.after
      ? (input.after as Record<string, unknown>)[fieldName]
      : undefined;
    const oldValue =
      oldRaw === undefined ? null : oldRaw === null ? "null" : String(oldRaw);
    const newValue =
      newRaw === undefined ? null : newRaw === null ? "null" : String(newRaw);
    if (oldValue === newValue) continue;
    entries.push({
      entityType: "ProposalItem",
      entityId: input.proposalItemId,
      action: input.action,
      fieldName,
      oldValue,
      newValue,
      performedBy: input.performedBy ?? null,
      reason: input.reason ?? null,
    });
  }
  return entries;
}
