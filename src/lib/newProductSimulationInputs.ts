/**
 * Ponte (pura) entre o estado da tela "Simular novo produto" e os INPUTS que o servidor
 * calcula. O cliente não envia mais números de resultado; envia composição, processo,
 * materiais e premissas — o servidor é a autoridade do snapshot.
 */
import type { FinalCompositionLine, SimulatedComponent } from "./newProductSandbox.js";
import type {
  NewProductSimulationSnapshot,
  NewProductSnapshotAnalysis,
} from "./newProductSimulationSnapshot.js";
import { isServerComputedSnapshot } from "./newProductSimulationSnapshot.js";
import {
  marginFromCostAndPrice,
  markupFactor,
  priceFromCostAndMargin,
} from "./pricing/commercialPriceFormula.js";
import type { ProductCostBaselineSource } from "./productCostBaseline.js";

export type NewProductCommercialPremisesState = {
  enabled: boolean;
  taxRuleId: string;
  commissionRatePct: string;
  otherRatePct: string;
  freight: string;
};

export const EMPTY_COMMERCIAL_PREMISES_STATE: NewProductCommercialPremisesState = {
  enabled: false,
  taxRuleId: "",
  commissionRatePct: "0",
  otherRatePct: "0",
  freight: "0",
};

export type NewProductWorkspaceState = {
  simulationName: string;
  productName: string;
  productSku: string;
  notes: string;
  mode: "MARGIN" | "TARGET_PRICE";
  desiredMarginPct: string;
  targetPrice: string;
  premises: NewProductCommercialPremisesState;
  lines: FinalCompositionLine[];
  simulatedComponents: SimulatedComponent[];
};

function num(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function existingLineBaselineSource(line: FinalCompositionLine): ProductCostBaselineSource {
  return line.type === "EXISTING_COMPONENT" && line.baselineSource === "PUBLISHED" ? "PUBLISHED" : "LIVE";
}

/** Chave do custo de um componente existente na base escolhida. */
export function existingCostKey(productId: string, source: ProductCostBaselineSource): string {
  return `${productId}|${source}`;
}

/**
 * Linha "em branco" da tela (componente ainda não escolhido / material direto sem descrição e
 * sem custo) nunca teve custo; é ignorada ao enviar, como sempre foi ignorada no total.
 */
export function isFilledCompositionLine(line: FinalCompositionLine): boolean {
  if (line.type === "DIRECT_MATERIAL") {
    return Boolean(line.description.trim()) || num(line.unitCost) > 0;
  }
  return Boolean(line.refId);
}

/** Monta o corpo `inputs` aceito por POST /api/new-product-simulations/{preview,save}. */
export function buildNewProductSimulationInputs(state: NewProductWorkspaceState) {
  const productName = state.productName.trim() || "Produto simulado";
  return {
    simulationName: state.simulationName.trim() || productName,
    productName,
    productSku: state.productSku.trim() || null,
    notes: state.notes.trim() || null,
    commercial: {
      mode: state.mode,
      desiredMarginPct: num(state.desiredMarginPct),
      targetPrice: num(state.targetPrice),
      premises:
        state.premises.enabled && state.premises.taxRuleId
          ? {
              taxRuleId: state.premises.taxRuleId,
              commissionRatePct: num(state.premises.commissionRatePct),
              otherRatePct: num(state.premises.otherRatePct),
              freight: num(state.premises.freight),
            }
          : null,
    },
    lines: state.lines.filter(isFilledCompositionLine).map((line) => {
      if (line.type === "DIRECT_MATERIAL") {
        return {
          id: line.id,
          type: line.type,
          description: line.description.trim() || "Material direto",
          unit: "UN",
          quantity: num(line.quantity),
          unitCost: num(line.unitCost),
        };
      }
      if (line.type === "SIMULATED_COMPONENT") {
        return { id: line.id, type: line.type, componentId: line.refId, quantity: num(line.quantity) };
      }
      return {
        id: line.id,
        type: line.type,
        productId: line.refId,
        quantity: num(line.quantity),
        baselineSource: existingLineBaselineSource(line),
      };
    }),
    simulatedComponents: state.simulatedComponents.map((component) => {
      const pi = component.processInputs;
      return {
        id: component.id,
        name: component.name,
        sku: component.sku ?? null,
        materials: component.materials.map((m) => ({
          materialId: m.materialId ?? null,
          code: m.code,
          description: m.description,
          unit: m.unit,
          quantity: num(m.quantity),
          unitCost: num(m.unitCost),
        })),
        process: pi?.useDefaultHourCosts
          ? {
              mode: "STANDARD" as const,
              cycleTimeSeconds: num(pi.cycleTimeSeconds),
              cavities: num(pi.cavities),
              efficiencyExpectedPercent: num(pi.efficiencyExpectedPercent),
              setupTimeMin: num(pi.setupTimeMin),
              lotSize: num(pi.lotSize),
            }
          : { mode: "MANUAL" as const, manualHh: num(component.hh), manualHm: num(component.hm) },
      };
    }),
  };
}

export type NewProductDisplayResult = {
  mp: number;
  hh: number;
  hm: number;
  costBase: number;
  mpPct: number;
  hhPct: number;
  hmPct: number;
  price: number | null;
  marginPct: number | null;
  analysisKind: NewProductSnapshotAnalysis["kind"];
  priceLabel: string;
  marginSign: NewProductSnapshotAnalysis["marginSign"];
  markupFactor: number | null;
  error: string | null;
  /** Snapshot legado: classificação antiga preservada só para exibição fiel. */
  legacyViability: "VIAVEL" | "ATENCAO" | "INVIAVEL" | null;
  legacy: boolean;
};

const INDUSTRIAL_LABEL = "Preço industrial preliminar (sem impostos, comissão e frete)";
const COMMERCIAL_LABEL = "Preço simulado (premissas comerciais da simulação)";

/** Resultado exibido de uma simulação congelada: exatamente o que está no snapshot. */
export function displayResultFromSnapshot(snapshot: NewProductSimulationSnapshot): NewProductDisplayResult {
  const r = snapshot.result;
  const legacy = !isServerComputedSnapshot(snapshot);
  const analysis = r.analysis;
  const price = typeof r.price === "number" ? r.price : null;
  const marginPct = typeof r.marginPct === "number" ? r.marginPct : null;
  return {
    mp: r.mp,
    hh: r.hh,
    hm: r.hm,
    costBase: r.costBase,
    mpPct: r.mpPct,
    hhPct: r.hhPct,
    hmPct: r.hmPct,
    price,
    marginPct,
    analysisKind: analysis?.kind ?? "INDUSTRIAL_PRELIMINARY",
    priceLabel: analysis?.priceLabel ?? INDUSTRIAL_LABEL,
    marginSign:
      analysis?.marginSign ??
      (price == null || marginPct == null
        ? "INDETERMINADA"
        : marginPct > 0 && price > r.costBase
          ? "POSITIVA"
          : "NULA_OU_NEGATIVA"),
    markupFactor: analysis?.markupFactor ?? (price == null ? null : markupFactor(price, r.costBase)),
    error: analysis?.error?.message ?? null,
    legacyViability: legacy ? (r.viability ?? null) : null,
    legacy,
  };
}

/**
 * Prévia local (UX) enquanto o usuário edita — mesma biblioteca pura usada pelo servidor.
 * O número oficial da simulação é sempre o devolvido pelo servidor ao salvar.
 */
export function previewNewProductDisplayResult(input: {
  mp: number;
  hh: number;
  hm: number;
  mode: "MARGIN" | "TARGET_PRICE";
  desiredMarginPct: number;
  targetPrice: number;
  premises: { taxRatePct: number; commissionRatePct: number; otherRatePct: number; freight: number } | null;
}): NewProductDisplayResult {
  const costBase = input.mp + input.hh + input.hm;
  const pct = (part: number) => (costBase > 0 ? (part / costBase) * 100 : 0);
  const premises = input.premises ?? { taxRatePct: 0, commissionRatePct: 0, otherRatePct: 0, freight: 0 };
  let price: number | null = null;
  let marginPct: number | null = null;
  let error: string | null = null;
  if (input.mode === "MARGIN") {
    const calc = priceFromCostAndMargin(costBase, premises, input.desiredMarginPct);
    if (calc.ok === true) {
      price = calc.price;
      marginPct = calc.marginRatePct;
    } else {
      error = calc.message;
    }
  } else {
    const calc = marginFromCostAndPrice(costBase, premises, input.targetPrice);
    if (calc.ok === true) {
      price = calc.price;
      marginPct = calc.marginRatePct;
    } else {
      error = calc.message;
    }
  }
  return {
    mp: input.mp,
    hh: input.hh,
    hm: input.hm,
    costBase,
    mpPct: pct(input.mp),
    hhPct: pct(input.hh),
    hmPct: pct(input.hm),
    price,
    marginPct,
    analysisKind: input.premises ? "COMMERCIAL_SIMULATED" : "INDUSTRIAL_PRELIMINARY",
    priceLabel: input.premises ? COMMERCIAL_LABEL : INDUSTRIAL_LABEL,
    marginSign:
      price == null || marginPct == null
        ? "INDETERMINADA"
        : marginPct > 0 && price > costBase
          ? "POSITIVA"
          : "NULA_OU_NEGATIVA",
    markupFactor: price == null ? null : markupFactor(price, costBase),
    error,
    legacyViability: null,
    legacy: false,
  };
}

export function marginSignLabel(sign: NewProductSnapshotAnalysis["marginSign"]): string {
  if (sign === "POSITIVA") return "Margem positiva";
  if (sign === "NULA_OU_NEGATIVA") return "Margem nula ou negativa";
  return "Margem indeterminada";
}
