import {
  DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT,
  normalizePricingPercentInput,
} from "./priceTablePublication.js";

export type ParsedPriceTableDraftGenerationBody = {
  effectiveDateRaw: string;
  taxRuleId: string | null;
  includeAllActiveProducts: boolean;
  productIds: string[];
  itemScope: string | undefined;
  notes: string | null;
  hasCommissionOverride: boolean;
  generationCommissionPerc: number | null;
  hasMarginOverride: boolean;
  marginPct: number | null;
  hasFreightOverride: boolean;
  freightPercent: number | null;
};

export function parsePriceTableDraftGenerationBody(
  body: Record<string, unknown>
): { ok: true; value: ParsedPriceTableDraftGenerationBody } | { ok: false; error: string } {
  const effectiveDateRaw =
    typeof body.effectiveDate === "string" && body.effectiveDate.trim()
      ? body.effectiveDate.trim()
      : null;
  if (!effectiveDateRaw) {
    return { ok: false, error: "effectiveDate é obrigatória (yyyy-mm-dd)." };
  }

  const taxRuleId =
    typeof body.taxRuleId === "string" && body.taxRuleId.trim() ? body.taxRuleId.trim() : null;
  const includeAllActiveProducts = body.includeAllActiveProducts === true;
  const productIds = Array.isArray(body.productIds)
    ? body.productIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const itemScope =
    typeof body.itemScope === "string" && body.itemScope.trim() ? body.itemScope.trim() : undefined;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  let hasCommissionOverride = false;
  let generationCommissionPerc: number | null = null;
  const rawCommission = body.commissionPerc;
  if (rawCommission !== undefined && rawCommission !== null && rawCommission !== "") {
    const parsed = typeof rawCommission === "number" ? rawCommission : Number(rawCommission);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
      return { ok: false, error: "Comissão do vendedor deve estar entre 0% e 50%." };
    }
    hasCommissionOverride = true;
    generationCommissionPerc = parsed;
  }

  let hasMarginOverride = false;
  let marginPct: number | null = null;
  if (body.marginPct !== undefined && body.marginPct !== null && body.marginPct !== "") {
    const parsed = normalizePricingPercentInput(body.marginPct, "Margem");
    if (parsed.ok === false) return { ok: false, error: parsed.message };
    if (parsed.value >= 100) {
      return { ok: false, error: "Margem deve ser inferior a 100%." };
    }
    hasMarginOverride = true;
    marginPct = parsed.value;
  }

  let hasFreightOverride = false;
  let freightPercent: number | null = null;
  if (body.freightPercent !== undefined && body.freightPercent !== null && body.freightPercent !== "") {
    const parsed = normalizePricingPercentInput(body.freightPercent, "Frete estimado");
    if (parsed.ok === false) return { ok: false, error: parsed.message };
    if (parsed.value >= 100) {
      return { ok: false, error: "Frete estimado deve ser inferior a 100%." };
    }
    hasFreightOverride = true;
    freightPercent = parsed.value;
  } else if (body.useDefaultFreightPercent === true) {
    hasFreightOverride = true;
    freightPercent = DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT;
  }

  if (productIds.length === 0 && !includeAllActiveProducts) {
    return {
      ok: false,
      error: "Informe productIds ou includeAllActiveProducts=true.",
    };
  }

  return {
    ok: true,
    value: {
      effectiveDateRaw,
      taxRuleId,
      includeAllActiveProducts,
      productIds,
      itemScope,
      notes,
      hasCommissionOverride,
      generationCommissionPerc,
      hasMarginOverride,
      marginPct,
      hasFreightOverride,
      freightPercent,
    },
  };
}
