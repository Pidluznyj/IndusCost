import { calculateAmortizedMoldCostPerUnit, toFiniteNumber } from "@/src/lib/projectsCalculations.js";
import type { ProjectMoldChargeMode } from "@/src/types/projects.js";

export function parseProjectsNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatProjectsNumberInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
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
