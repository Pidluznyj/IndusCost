import type { CalculationExplanation, CalculationExplainabilityMap } from "../types/calculation";

function brMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function brPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}

type AnalysisLike = {
  totalMaterialCost: number;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalCIF_Unit: number;
  totalOPEX_Unit: number;
  totalIndustrialCost: number;
  totalGerencialCost: number;
  sku?: string;
  name?: string;
  warnings?: Array<{ message?: string }>;
  details?: {
    materials?: Array<{ description?: string; unitCost?: number }>;
    processBreakdown?: unknown[];
  };
};

const motorSource = "Motor getProductCostAnalysis (CIU + CIF proporcional ao tempo; OPEX à parte no custo gerencial).";

/**
 * Monta explicativas agregadas a partir do resultado já calculado pelo motor (sem alterar números).
 */
export function buildCostAnalysisExplainability(analysis: AnalysisLike): CalculationExplainabilityMap {
  const warnTexts =
    Array.isArray(analysis.warnings) && analysis.warnings.length > 0
      ? analysis.warnings.map((w) => (typeof w.message === "string" ? w.message : String(w)))
      : undefined;

  const mat = Number(analysis.totalMaterialCost);
  const hh = Number(analysis.totalHH_Unit);
  const hm = Number(analysis.totalHM_Unit);
  const conv = hh + hm;
  const cif = Number(analysis.totalCIF_Unit);
  const opex = Number(analysis.totalOPEX_Unit);
  const ciu = Number(analysis.totalIndustrialCost);
  const cger = Number(analysis.totalGerencialCost);

  const bomInputs: { label: string; value: string }[] = [];
  const mats = analysis.details?.materials;
  if (Array.isArray(mats) && mats.length > 0) {
    const maxLines = 25;
    for (let i = 0; i < Math.min(mats.length, maxLines); i++) {
      const row = mats[i];
      bomInputs.push({
        label: row.description ?? `Linha ${i + 1}`,
        value: brMoney(Number(row.unitCost)),
      });
    }
    if (mats.length > maxLines) {
      bomInputs.push({
        label: "…",
        value: `+ ${mats.length - maxLines} linha(s) adicional(is)`,
      });
    }
  }

  const totalMaterialCost: CalculationExplanation = {
    title: "Custo da estrutura (BOM) — parcela material",
    description:
      "MP direta na BOM (custo aterrissado × qtd com perda) mais parcela de material dos componentes filhos (recursivo). Não inclui HH/HM/CIF dos filhos — estes aparecem em Conversão e CIF.",
    formulaText: "Material na CIU = MP direta + Σ (material unitário do filho × qtd com perda).",
    inputs: bomInputs.length > 0 ? bomInputs : [{ label: "Total consolidado (sem detalhe de linhas nesta resposta)", value: brMoney(mat) }],
    resultLabel: "Total BOM",
    resultValue: mat,
    notes: "Produtos finais podem ter MP direta na BOM; filhos fabricados contribuem com MP + conversão + CIF agregados nos cards.",
    warnings: warnTexts,
    source: motorSource,
  };

  const totalConversionCost: CalculationExplanation = {
    title: "Conversão (mão de obra + máquina)",
    description:
      "HH+HM do processo deste item e, quando há filhos fabricados na BOM, HH+HM dos filhos agregados proporcionalmente à quantidade (sem dupla contagem com o total da BOM).",
    formulaText: "totalConversionCost = totalHH_Unit + totalHM_Unit (inclui rollup dos filhos).",
    inputs: [
      { label: "HH unitário (alocado)", value: brMoney(hh) },
      { label: "HM unitário (alocado)", value: brMoney(hm) },
    ],
    resultLabel: "Conversão",
    resultValue: conv,
    source: motorSource,
  };

  const totalCIF_Unit: CalculationExplanation = {
    title: "CIF unitário rateado",
    description:
      "CIF do tempo produtivo deste item e CIF agregado dos filhos fabricados (proporcional à qtd na BOM), além do rateio por tempo próprio.",
    formulaText: "totalCIF_Unit = tempoProdutivoUnitário_h × (Σ CIF mensal / horas fábrica mensais).",
    inputs: [{ label: "Tempo produtivo embutido nas operações", value: "(ver detalhamento de processo)" }],
    resultLabel: "CIF unitário",
    resultValue: cif,
    source: motorSource,
  };

  const totalIndustrialCost: CalculationExplanation = {
    title: "Custo industrial unitário (CIU)",
    description:
      "Custo industrial completo por unidade: estrutura (BOM) + conversão + CIF industrial rateado ao produto.",
    formulaText: "CIU = totalMaterialCost + totalHH_Unit + totalHM_Unit + totalCIF_Unit.",
    inputs: [
      { label: "BOM", value: brMoney(mat) },
      { label: "HH", value: brMoney(hh) },
      { label: "HM", value: brMoney(hm) },
      { label: "CIF", value: brMoney(cif) },
    ],
    resultLabel: "CIU",
    resultValue: ciu,
    warnings: warnTexts,
    source: motorSource,
  };

  const totalOPEX_Unit: CalculationExplanation = {
    title: "OPEX unitário (referência)",
    description:
      "Parcela de OPEX associada ao tempo produtivo unitário (referência gerencial; o CIU acima já está completo para formação de preço conforme premissas do sistema).",
    formulaText: "totalOPEX_Unit = tempoProdutivoUnitário_h × taxaOPEX/h.",
    inputs: [{ label: "OPEX unitário", value: brMoney(opex) }],
    resultLabel: "OPEX unitário",
    resultValue: opex,
    source: motorSource,
  };

  const totalGerencialCost: CalculationExplanation = {
    title: "Custo gerencial (CIU + OPEX)",
    description: "Soma do custo industrial unitário com o OPEX unitário de referência.",
    formulaText: "Custo gerencial = totalIndustrialCost + totalOPEX_Unit.",
    inputs: [
      { label: "CIU", value: brMoney(ciu) },
      { label: "OPEX", value: brMoney(opex) },
    ],
    resultLabel: "Total gerencial",
    resultValue: cger,
    source: motorSource,
  };

  return {
    totalMaterialCost,
    totalConversionCost,
    totalCIF_Unit,
    totalIndustrialCost,
    totalOPEX_Unit,
    totalGerencialCost,
  };
}

export type PricingSnapshotExplainParams = {
  analysis: AnalysisLike;
  taxRate: number;
  commRate: number;
  marginRate: number;
  otherRate: number;
  freight: number;
  suggestedPrice: number;
  divisor: number;
};

export function buildPricingSnapshotExplainability(p: PricingSnapshotExplainParams): {
  unitCost: CalculationExplanation;
  suggestedPrice: CalculationExplanation;
} {
  const ciu = Number(p.analysis.totalIndustrialCost);
  const warnTexts =
    Array.isArray(p.analysis.warnings) && p.analysis.warnings.length > 0
      ? p.analysis.warnings.map((w) => (typeof w.message === "string" ? w.message : String(w)))
      : undefined;

  const unitCost: CalculationExplanation = {
    title: "Custo industrial (base do preço)",
    description: "Mesmo CIU do motor de custo; usado como unitCost no snapshot comercial.",
    formulaText: "unitCost = totalIndustrialCost do getProductCostAnalysis.",
    inputs: [
      { label: "CIU (motor)", value: brMoney(ciu) },
    ],
    resultLabel: "unitCost",
    resultValue: ciu,
    warnings: warnTexts,
    source: "GET /api/products/:id/pricing-snapshot",
  };

  const suggestedPrice: CalculationExplanation = {
    title: "Preço sugerido (markup divisor)",
    description:
      "Preço de venda sugerido a partir do custo industrial, frete de saída da premissa e taxas de imposto, comissão, outros e margem desejada no divisor.",
    formulaText: "suggestedPrice = (CIU + frete) / (1 − imposto − comissão − outros − margem).",
    inputs: [
      { label: "CIU + frete", value: brMoney(ciu + p.freight) },
      { label: "Impostos (soma % regra fiscal)", value: brPct(p.taxRate * 100) },
      { label: "Comissão %", value: brPct(p.commRate * 100) },
      { label: "Outros %", value: brPct(p.otherRate * 100) },
      { label: "Margem desejada % (premissa)", value: brPct(p.marginRate * 100) },
      { label: "Divisor (1 − soma das taxas)", value: p.divisor > 0 ? p.divisor.toFixed(6) : "≤ 0 (inválido)" },
    ],
    resultLabel: "Preço sugerido",
    resultValue: p.suggestedPrice,
    notes: p.divisor <= 0 ? "Divisor não positivo: preço sugerido fica 0 no endpoint." : undefined,
    warnings: warnTexts,
    source: "GET /api/products/:id/pricing-snapshot",
  };

  return { unitCost, suggestedPrice };
}
