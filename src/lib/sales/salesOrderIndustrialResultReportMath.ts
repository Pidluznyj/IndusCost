/**
 * Matemática pura do Relatório de Resultado Industrial dos Pedidos.
 * Frontend-safe: sem Prisma.
 */
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import { roundPricingPercent } from "@/src/lib/pricingCalculations.js";

export type IndustrialTaxSource = "REAL" | "ESTIMADO" | "MISTO" | "INCOMPLETO";

export type IndustrialCostSourceStatus =
  | "OK"
  | "CUSTO_NAO_LOCALIZADO"
  | "CUSTO_AMBIGUO"
  | "INCOMPLETO";

export type IndustrialTaxBreakdown = {
  icms: number;
  ipi: number;
  pis: number;
  cofins: number;
  icmsSt: number;
  difal: number;
  fcp: number;
  otherTaxes: number;
  totalTaxes: number;
};

export type IndustrialCostBreakdown = {
  materialCost: number;
  laborHourCost: number;
  machineHourCost: number;
  otherIndustrialCost: number;
  totalIndustrialCost: number;
};

export type IndustrialResultComputation = {
  revenueAfterTaxes: number;
  industrialResult: number;
  industrialMarginPercent: number | null;
};

const ZERO_TAX: IndustrialTaxBreakdown = {
  icms: 0,
  ipi: 0,
  pis: 0,
  cofins: 0,
  icmsSt: 0,
  difal: 0,
  fcp: 0,
  otherTaxes: 0,
  totalTaxes: 0,
};

export function emptyIndustrialTaxBreakdown(): IndustrialTaxBreakdown {
  return { ...ZERO_TAX };
}

/** Reconcilia MP + HH + HM + outros = total (outros = residual). */
export function reconcileIndustrialCostBreakdown(input: {
  materialCost: number;
  laborHourCost: number;
  machineHourCost: number;
  totalIndustrialCost: number;
  /** Se informado e >= 0, usa categoria oficial; senão residual. */
  otherIndustrialCostOfficial?: number | null;
}): IndustrialCostBreakdown {
  const materialCost = roundMoney(Math.max(0, input.materialCost));
  const laborHourCost = roundMoney(Math.max(0, input.laborHourCost));
  const machineHourCost = roundMoney(Math.max(0, input.machineHourCost));
  const totalIndustrialCost = roundMoney(Math.max(0, input.totalIndustrialCost));
  const officialOther =
    input.otherIndustrialCostOfficial != null &&
    Number.isFinite(input.otherIndustrialCostOfficial)
      ? roundMoney(Math.max(0, input.otherIndustrialCostOfficial))
      : null;
  const residual = roundMoney(
    totalIndustrialCost - materialCost - laborHourCost - machineHourCost
  );
  const otherIndustrialCost =
    officialOther != null ? officialOther : Math.max(0, residual);
  return {
    materialCost,
    laborHourCost,
    machineHourCost,
    otherIndustrialCost,
    totalIndustrialCost,
  };
}

export function sumIndustrialTaxBreakdown(
  parts: ReadonlyArray<Partial<IndustrialTaxBreakdown>>
): IndustrialTaxBreakdown {
  const out = emptyIndustrialTaxBreakdown();
  for (const part of parts) {
    out.icms = roundMoney(out.icms + (part.icms ?? 0));
    out.ipi = roundMoney(out.ipi + (part.ipi ?? 0));
    out.pis = roundMoney(out.pis + (part.pis ?? 0));
    out.cofins = roundMoney(out.cofins + (part.cofins ?? 0));
    out.icmsSt = roundMoney(out.icmsSt + (part.icmsSt ?? 0));
    out.difal = roundMoney(out.difal + (part.difal ?? 0));
    out.fcp = roundMoney(out.fcp + (part.fcp ?? 0));
    out.otherTaxes = roundMoney(out.otherTaxes + (part.otherTaxes ?? 0));
  }
  out.totalTaxes = roundMoney(
    out.icms +
      out.ipi +
      out.pis +
      out.cofins +
      out.icmsSt +
      out.difal +
      out.fcp +
      out.otherTaxes
  );
  return out;
}

/** Garante totalTaxes = soma das colunas; residual vai para otherTaxes. */
export function reconcileTaxBreakdownColumns(
  input: IndustrialTaxBreakdown
): IndustrialTaxBreakdown {
  const known = roundMoney(
    input.icms +
      input.ipi +
      input.pis +
      input.cofins +
      input.icmsSt +
      input.difal +
      input.fcp
  );
  let otherTaxes = roundMoney(Math.max(0, input.otherTaxes));
  if (input.totalTaxes > 0 && input.totalTaxes > known + otherTaxes + 0.009) {
    otherTaxes = roundMoney(input.totalTaxes - known);
  }
  const totalTaxes = roundMoney(known + otherTaxes);
  return {
    icms: roundMoney(input.icms),
    ipi: roundMoney(input.ipi),
    pis: roundMoney(input.pis),
    cofins: roundMoney(input.cofins),
    icmsSt: roundMoney(input.icmsSt),
    difal: roundMoney(input.difal),
    fcp: roundMoney(input.fcp),
    otherTaxes: Math.max(0, otherTaxes),
    totalTaxes,
  };
}

export function computeIndustrialResult(input: {
  orderCommercialValue: number;
  totalTaxes: number;
  totalIndustrialCost: number;
}): IndustrialResultComputation {
  const orderCommercialValue = roundMoney(Math.max(0, input.orderCommercialValue));
  const totalTaxes = roundMoney(Math.max(0, input.totalTaxes));
  const totalIndustrialCost = roundMoney(Math.max(0, input.totalIndustrialCost));
  const revenueAfterTaxes = roundMoney(orderCommercialValue - totalTaxes);
  const industrialResult = roundMoney(revenueAfterTaxes - totalIndustrialCost);
  const industrialMarginPercent =
    revenueAfterTaxes > 0
      ? roundPricingPercent((industrialResult / revenueAfterTaxes) * 100)
      : null;
  return { revenueAfterTaxes, industrialResult, industrialMarginPercent };
}

export function classifyIndustrialTaxSource(input: {
  realTaxTotal: number;
  estimatedTaxTotal: number;
  incomplete: boolean;
}): IndustrialTaxSource {
  if (input.incomplete) return "INCOMPLETO";
  const hasReal = input.realTaxTotal > 0.009;
  const hasEstimated = input.estimatedTaxTotal > 0.009;
  if (hasReal && hasEstimated) return "MISTO";
  if (hasReal) return "REAL";
  if (hasEstimated) return "ESTIMADO";
  // Pedido sem imposto (alíquota 0 / sem NF) — tratado como estimado zerado.
  return "ESTIMADO";
}

/**
 * Parte ainda não faturada (valor): max(0, comercial − faturado).
 * Nunca estima imposto sobre o que já foi faturado.
 */
export function resolveUninvoicedCommercialValue(input: {
  orderCommercialValue: number;
  invoicedComparableValue: number;
}): number {
  return roundMoney(
    Math.max(0, input.orderCommercialValue - Math.max(0, input.invoicedComparableValue))
  );
}

export function industrialTaxSourceLabel(source: IndustrialTaxSource): string {
  switch (source) {
    case "REAL":
      return "Real (NF)";
    case "ESTIMADO":
      return "Estimado";
    case "MISTO":
      return "Misto";
    case "INCOMPLETO":
      return "Incompleto";
    default:
      return source;
  }
}

export function industrialCostSourceStatusLabel(
  status: IndustrialCostSourceStatus
): string {
  switch (status) {
    case "OK":
      return "Histórico publicado";
    case "CUSTO_NAO_LOCALIZADO":
      return "Custo não localizado";
    case "CUSTO_AMBIGUO":
      return "Custo ambíguo";
    case "INCOMPLETO":
      return "Custo incompleto";
    default:
      return status;
  }
}

/** Margem consolidada: resultado ÷ receita após impostos (não média simples). */
export function computeConsolidatedIndustrialMarginPercent(input: {
  industrialResultTotal: number;
  revenueAfterTaxesTotal: number;
}): number | null {
  if (input.revenueAfterTaxesTotal <= 0) return null;
  return roundPricingPercent(
    (input.industrialResultTotal / input.revenueAfterTaxesTotal) * 100
  );
}
