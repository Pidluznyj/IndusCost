/**
 * Projetos — fonte única de valores dos documentos (regra pura).
 *
 * Decisão aprovada em 2026-10-15: os cinco documentos usam a PRECIFICAÇÃO SALVA
 * ("Salvar precificação" → ProjectPricingItem), com o imposto gravado naquele momento.
 * Nada aqui recalcula preço com custo/regra fiscal atuais; o motor vivo
 * (computeLiveProjectPricingView) é usado só para DETECTAR divergência desde a gravação.
 *
 * Não é outra engine de preço: os valores vêm dos snapshots gravados pela engine oficial
 * (computeProjectPricingItem). A única derivação é separar o preço do produto do adicional de
 * amortização no preço final, com a mesma fórmula oficial sobre os insumos gravados.
 */
import { calculateSalePriceFromCost, roundPricingMoney } from "./pricingCalculations.js";
import {
  computeLiveProjectPricingView,
  type ProjectPricingItemView,
  type ProjectPricingView,
  type SavedProjectPricingItem,
} from "./projectsPricing.js";
import type { ProjectDetail } from "@/src/types/projects.js";

export type ProjectDocumentValueMode = "SAVED_PRICING" | "NO_SAVED_PRICING";

export const PROJECT_DOCUMENT_VALUE_MODE_LABELS: Record<ProjectDocumentValueMode, string> = {
  SAVED_PRICING: "Precificação salva do projeto",
  NO_SAVED_PRICING: "Sem precificação salva — preços a definir",
};

export type ProjectDocumentStaleReason = {
  code:
    | "ITEM_NOT_PRICED"
    | "ITEM_REMOVED"
    | "BASE_COST_CHANGED"
    | "AMORTIZATION_CHANGED"
    | "TAX_RULE_CHANGED"
    | "PRICE_CHANGED";
  targetItemId: string;
  itemLabel: string;
  message: string;
};

export type ProjectDocumentValueSource = {
  mode: ProjectDocumentValueMode;
  /** Instante da última gravação da precificação (maior updatedAt dos itens). */
  pricingSavedAt: string | null;
  /** Itens com os valores GRAVADOS (mesmo formato do grid, para os geradores existentes). */
  view: ProjectPricingView;
  stale: boolean;
  staleReasons: ProjectDocumentStaleReason[];
};

/** Tolerância de comparação (valores gravados com 6 casas; documento mostra centavos). */
const MONEY_EPS = 0.005;
const PERCENT_EPS = 0.0001;

const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : roundPricingMoney(v));
const brl = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;

const STATUS_LABEL: Record<string, string> = {
  NO_COST: "Sem custo",
  PENDING: "Pendente",
  CALCULATED: "Calculado",
  ERROR: "Erro",
};

/** Converte um item gravado no formato de exibição, sem recalcular nada além do desmembramento. */
export function savedPricingItemToView(saved: SavedProjectPricingItem): ProjectPricingItemView {
  const finalPrice = money(saved.suggestedPrice);
  let productPrice: number | null = null;
  if (saved.status === "CALCULATED" && saved.finalUnitCostSnapshot > 0) {
    const r = calculateSalePriceFromCost({
      cost: saved.finalUnitCostSnapshot,
      taxPercent: saved.taxPercentSnapshot,
      targetMarginPercent: saved.targetMarginPercent,
    });
    productPrice = r.ok === true ? r.suggestedPrice : null;
  }
  const addOn =
    finalPrice != null && productPrice != null ? Math.max(0, roundPricingMoney(finalPrice - productPrice)) : 0;
  return {
    targetItemId: saved.targetItemId,
    targetItemType: saved.targetItemType,
    displayName: saved.targetDescriptionSnapshot,
    costBaseUnit: roundPricingMoney(saved.costBaseUnitSnapshot),
    amortizationUnitCost: roundPricingMoney(saved.amortizationUnitCostSnapshot),
    amortizationPriceAddOnUnit: addOn,
    finalUnitCost: roundPricingMoney(saved.finalUnitCostSnapshot),
    fiscalRuleId: saved.fiscalRuleId,
    fiscalRuleName: saved.fiscalRuleNameSnapshot,
    taxPercent: saved.taxPercentSnapshot,
    targetMarginPercent: saved.targetMarginPercent,
    suggestedPrice: finalPrice,
    suggestedPriceWithoutAmortization: money(saved.suggestedPriceWithoutAmortization),
    suggestedPriceWithAmortization: finalPrice,
    agreedCustomerPrice:
      saved.agreedCustomerPrice != null && Number.isFinite(saved.agreedCustomerPrice) && saved.agreedCustomerPrice > 0
        ? money(saved.agreedCustomerPrice)
        : null,
    calculatedProductPrice: productPrice,
    taxAmountWithoutAmortization: money(saved.taxAmountWithoutAmortization),
    marginAmountWithoutAmortization: money(saved.marginAmountWithoutAmortization),
    taxAmount: money(saved.taxAmount),
    marginAmount: money(saved.marginAmount),
    projectRecoveryValue: productPrice != null ? addOn : null,
    commissionableBaseWithoutProjectRecovery: productPrice,
    status: saved.status,
    statusLabel: STATUS_LABEL[saved.status] ?? saved.status,
    errorMessage: null,
  };
}

function differs(a: number | null | undefined, b: number | null | undefined, eps = MONEY_EPS): boolean {
  if (a == null || b == null) return (a == null) !== (b == null);
  return Math.abs(a - b) > eps;
}

/**
 * Compara a precificação gravada com o que a engine oficial calcularia hoje (custos,
 * amortização e regra fiscal atuais, mantendo margem/regra escolhidas). Só alerta; não altera.
 */
export function detectSavedPricingStaleness(
  savedItems: readonly SavedProjectPricingItem[],
  live: ProjectPricingView,
): ProjectDocumentStaleReason[] {
  const reasons: ProjectDocumentStaleReason[] = [];
  const savedById = new Map(savedItems.map((s) => [s.targetItemId, s]));
  const liveById = new Map(live.items.map((i) => [i.targetItemId, i]));
  for (const item of live.items) {
    const saved = savedById.get(item.targetItemId);
    if (!saved) {
      reasons.push({
        code: "ITEM_NOT_PRICED",
        targetItemId: item.targetItemId,
        itemLabel: item.displayName,
        message: `${item.displayName}: item sem precificação salva.`,
      });
      continue;
    }
    const before = reasons.length;
    if (differs(saved.costBaseUnitSnapshot, item.costBaseUnit)) {
      reasons.push({
        code: "BASE_COST_CHANGED",
        targetItemId: item.targetItemId,
        itemLabel: item.displayName,
        message: `${item.displayName}: custo base mudou de ${brl(saved.costBaseUnitSnapshot)} para ${brl(item.costBaseUnit)}.`,
      });
    }
    if (differs(saved.amortizationUnitCostSnapshot, item.amortizationUnitCost)) {
      reasons.push({
        code: "AMORTIZATION_CHANGED",
        targetItemId: item.targetItemId,
        itemLabel: item.displayName,
        message: `${item.displayName}: amortização no custo mudou de ${brl(saved.amortizationUnitCostSnapshot)} para ${brl(item.amortizationUnitCost)}.`,
      });
    }
    if (saved.fiscalRuleId === item.fiscalRuleId && differs(saved.taxPercentSnapshot, item.taxPercent, PERCENT_EPS)) {
      reasons.push({
        code: "TAX_RULE_CHANGED",
        targetItemId: item.targetItemId,
        itemLabel: item.displayName,
        message: `${item.displayName}: a regra fiscal "${saved.fiscalRuleNameSnapshot ?? "—"}" mudou de ${pct(saved.taxPercentSnapshot)} para ${pct(item.taxPercent)}.`,
      });
    }
    if (reasons.length === before && differs(saved.suggestedPrice, item.suggestedPrice)) {
      reasons.push({
        code: "PRICE_CHANGED",
        targetItemId: item.targetItemId,
        itemLabel: item.displayName,
        message: `${item.displayName}: o preço calculado hoje (${brl(item.suggestedPrice)}) difere do gravado (${brl(saved.suggestedPrice)}).`,
      });
    }
  }
  for (const saved of savedItems) {
    if (!liveById.has(saved.targetItemId)) {
      reasons.push({
        code: "ITEM_REMOVED",
        targetItemId: saved.targetItemId,
        itemLabel: saved.targetDescriptionSnapshot,
        message: `${saved.targetDescriptionSnapshot}: item precificado não existe mais no projeto.`,
      });
    }
  }
  return reasons;
}

export function buildProjectDocumentValueSource(detail: ProjectDetail): ProjectDocumentValueSource {
  const saved = detail.projectPricingSaved;
  const savedItems = saved?.items ?? [];
  const live = computeLiveProjectPricingView(detail);
  const hasSaved = savedItems.some((s) => s.suggestedPrice != null && s.suggestedPrice > 0);
  if (!hasSaved) {
    // Sem gravação: custos de referência continuam visíveis, mas nenhum preço é exibido.
    const view: ProjectPricingView = {
      config: live.config,
      taxRules: live.taxRules,
      hasSavedPricing: false,
      items: live.items.map((i) => ({
        ...i,
        suggestedPrice: null,
        suggestedPriceWithoutAmortization: null,
        suggestedPriceWithAmortization: null,
        agreedCustomerPrice: null,
        calculatedProductPrice: null,
        taxAmount: null,
        marginAmount: null,
        taxAmountWithoutAmortization: null,
        marginAmountWithoutAmortization: null,
        projectRecoveryValue: null,
        commissionableBaseWithoutProjectRecovery: null,
        status: i.status === "NO_COST" ? "NO_COST" : "PENDING",
        statusLabel: "Sem precificação salva",
      })),
    };
    return { mode: "NO_SAVED_PRICING", pricingSavedAt: null, view, stale: false, staleReasons: [] };
  }
  // Ordem de exibição = ordem atual do projeto; itens removidos depois vão ao fim.
  const liveOrder = new Map(live.items.map((i, idx) => [i.targetItemId, idx]));
  const ordered = [...savedItems].sort(
    (a, b) => (liveOrder.get(a.targetItemId) ?? 1e9) - (liveOrder.get(b.targetItemId) ?? 1e9),
  );
  const staleReasons = detectSavedPricingStaleness(savedItems, live);
  const savedAt = savedItems
    .map((s) => s.savedAt ?? null)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;
  return {
    mode: "SAVED_PRICING",
    pricingSavedAt: savedAt,
    view: {
      config: saved?.config ?? live.config,
      taxRules: live.taxRules,
      hasSavedPricing: true,
      items: ordered.map(savedPricingItemToView),
    },
    stale: staleReasons.length > 0,
    staleReasons,
  };
}
