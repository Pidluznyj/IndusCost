import {
  calculateAmortizedMoldCostPerUnit,
  calculateStructureLineTotalCost,
  toFiniteNumber,
} from "@/src/lib/projectsCalculations.js";
import type {
  ProjectMoldChargeMode,
  ProjectMoldRow,
  ProjectStructureLineRow,
} from "@/src/types/projects.js";

/**
 * Converte texto de input numérico (pt-BR e en-US simples) em number.
 * Casos:
 * - "1.234,56" / "10,5" → BR
 * - "37.5" / "1234.56" → ponto decimal (não trata como milhar)
 * - "1.234.567" → milhares BR sem decimais
 */
export function parseProjectsNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // Separador decimal = o que aparece por último.
    if (trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".")) {
      normalized = trimmed.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = trimmed.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = trimmed.replace(",", ".");
  } else if (hasDot) {
    const parts = trimmed.split(".");
    // Um único ponto → decimal ("37.5"), não milhar.
    // Vários pontos → milhares BR ("1.234.567").
    normalized = parts.length === 2 ? trimmed : trimmed.replace(/\./g, "");
  } else {
    normalized = trimmed;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatProjectsNumberInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  // Usa vírgula decimal para round-trip seguro com parseProjectsNumberInput.
  return String(value).replace(".", ",");
}

export function suggestAmortizedCostPerUnit(
  constructionCost: number | null,
  amortizationQuantity: number | null,
  chargeMode: ProjectMoldChargeMode,
  manualOverride: boolean
): number | null {
  if (manualOverride) return null;
  if (chargeMode !== "AMORTIZED_IN_PRODUCT") return null;
  if (constructionCost == null || amortizationQuantity == null) return null;
  return calculateAmortizedMoldCostPerUnit(constructionCost, amortizationQuantity);
}

export const MOLD_CHARGE_MODE_OPTIONS: { value: ProjectMoldChargeMode; label: string }[] = [
  { value: "CHARGED_SEPARATELY", label: "Cobrado separado" },
  { value: "AMORTIZED_IN_PRODUCT", label: "Amortizado no produto" },
  { value: "PARTIALLY_ABSORBED", label: "Parcialmente absorvido" },
  { value: "INTERNAL_INVESTMENT", label: "Investimento interno" },
];

export const MOLD_OWNERSHIP_OPTIONS = [
  { value: "CUSTOMER", label: "Cliente" },
  { value: "COMPANY", label: "Empresa" },
  { value: "SHARED", label: "Compartilhado" },
  { value: "UNDEFINED", label: "Indefinido" },
] as const;

export function buildMoldPayloadFromForm(form: {
  name: string;
  moldType: string;
  cavities: string;
  estimatedLifeCycles: string;
  supplierName: string;
  constructionCost: string;
  maintenanceCost: string;
  changeCost: string;
  leadTimeDays: string;
  chargeMode: ProjectMoldChargeMode;
  amortizationQuantity: string;
  amortizedCostPerUnit: string;
  amortizedManual: boolean;
  ownership: string;
  notes: string;
}) {
  const constructionCost = parseProjectsNumberInput(form.constructionCost) ?? 0;
  const amortizationQuantity = parseProjectsNumberInput(form.amortizationQuantity);
  const manualAmort = parseProjectsNumberInput(form.amortizedCostPerUnit);
  const suggested = suggestAmortizedCostPerUnit(
    constructionCost,
    amortizationQuantity,
    form.chargeMode,
    form.amortizedManual
  );
  const amortizedCostPerUnit = form.amortizedManual
    ? manualAmort
    : suggested ?? manualAmort;

  return {
    name: form.name.trim(),
    moldType: form.moldType.trim() || null,
    cavities: form.cavities.trim() ? Math.floor(toFiniteNumber(parseProjectsNumberInput(form.cavities))) : null,
    estimatedLifeCycles: form.estimatedLifeCycles.trim()
      ? Math.floor(toFiniteNumber(parseProjectsNumberInput(form.estimatedLifeCycles)))
      : null,
    supplierName: form.supplierName.trim() || null,
    constructionCost,
    maintenanceCost: parseProjectsNumberInput(form.maintenanceCost),
    changeCost: parseProjectsNumberInput(form.changeCost),
    leadTimeDays: form.leadTimeDays.trim()
      ? Math.floor(toFiniteNumber(parseProjectsNumberInput(form.leadTimeDays)))
      : null,
    chargeMode: form.chargeMode,
    amortizationQuantity,
    amortizedCostPerUnit:
      amortizedCostPerUnit != null && Number.isFinite(amortizedCostPerUnit)
        ? amortizedCostPerUnit
        : null,
    ownership: form.ownership,
    notes: form.notes.trim() || null,
  };
}

export function moldRowToForm(mold: ProjectMoldRow) {
  return {
    name: mold.name,
    moldType: mold.moldType ?? "",
    cavities: mold.cavities != null ? String(mold.cavities) : "",
    estimatedLifeCycles: mold.estimatedLifeCycles != null ? String(mold.estimatedLifeCycles) : "",
    supplierName: mold.supplierName ?? "",
    constructionCost: formatProjectsNumberInput(mold.constructionCost),
    maintenanceCost: formatProjectsNumberInput(mold.maintenanceCost),
    changeCost: formatProjectsNumberInput(mold.changeCost),
    leadTimeDays: mold.leadTimeDays != null ? String(mold.leadTimeDays) : "",
    chargeMode: mold.chargeMode,
    amortizationQuantity: formatProjectsNumberInput(mold.amortizationQuantity),
    amortizedCostPerUnit: formatProjectsNumberInput(mold.amortizedCostPerUnit),
    amortizedManual: mold.amortizedCostPerUnit != null,
    ownership: mold.ownership,
    notes: mold.notes ?? "",
  };
}

export function isLaborStructureLine(line: Pick<ProjectStructureLineRow, "sourceType" | "unitSnapshot" | "lineType">) {
  return (
    line.sourceType === "MANUAL" &&
    (line.unitSnapshot === "HH" || line.lineType === "PROCESS" || line.lineType === "SERVICE")
  );
}

export function structureLineTypeLabel(line: Pick<ProjectStructureLineRow, "sourceType" | "unitSnapshot" | "lineType">) {
  if (isLaborStructureLine(line)) return "HH / Mão de obra";
  return line.lineType;
}

export function buildLaborLinePayload(form: {
  description: string;
  hours: string;
  hourlyRate: string;
  lossPercent: string;
  notes: string;
}) {
  const quantity = parseProjectsNumberInput(form.hours) ?? 0;
  const unitCost = parseProjectsNumberInput(form.hourlyRate) ?? 0;
  const lossPercent = parseProjectsNumberInput(form.lossPercent) ?? 0;
  return {
    sourceType: "MANUAL" as const,
    lineType: "PROCESS" as const,
    description: form.description.trim() || "Hora-homem",
    unit: "HH",
    quantity,
    unitCost,
    lossPercent,
    notes: form.notes.trim() || null,
  };
}

export function calculateLaborLineTotal(hours: number, hourlyRate: number, lossPercent = 0) {
  const total = calculateStructureLineTotalCost(hours, hourlyRate, lossPercent);
  return Number.isFinite(total) ? total : 0;
}

export function formatProjectGuidedItemCost(
  estimatedCost: number | null | undefined,
  status?: "PENDING_COST" | string
): string {
  if (estimatedCost != null && Number.isFinite(estimatedCost) && estimatedCost > 0) {
    return estimatedCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (status === "PENDING_COST") return "Sem custo";
  return "—";
}
