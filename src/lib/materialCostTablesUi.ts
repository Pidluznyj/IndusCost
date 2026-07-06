/**
 * Labels e permissões — tabelas oficiais de custo de matéria-prima (sem Prisma).
 */
import type { EffectiveMaterialCostResult } from "./materialCostVersioning.js";

export const MATERIAL_COST_TABLE_VIEW_PERMISSIONS = [
  "pricing.view",
  "pricing.generate_tables",
  "settings.price_tables.view",
  "costs.view",
  "purchases.view",
] as const;

export const MATERIAL_COST_TABLE_MANAGE_PERMISSIONS = [
  "pricing.generate_tables",
  "settings.price_tables.manage",
] as const;

export const MATERIAL_COST_TABLE_PUBLISH_PERMISSIONS = [
  "pricing.publish_tables",
  "settings.price_tables.manage",
] as const;

export const MATERIAL_COST_IMMUTABLE_NOTICE =
  "Versões publicadas de matéria-prima são fotos oficiais e não podem ser editadas. Correções geram nova revisão.";

export function formatMaterialCostVersionStatusLabel(status: string | null | undefined): string {
  switch (String(status ?? "").toUpperCase()) {
    case "DRAFT":
      return "Rascunho";
    case "PUBLISHED":
      return "Publicada";
    case "SUPERSEDED":
      return "Substituída";
    case "ARCHIVED":
      return "Arquivada";
    default:
      return status ?? "—";
  }
}

export function formatEffectiveMaterialCostSummary(input: {
  materialCode: string;
  referenceDate: string | Date;
  result: EffectiveMaterialCostResult;
}): string {
  const ref =
    input.referenceDate instanceof Date
      ? input.referenceDate.toISOString().slice(0, 10)
      : String(input.referenceDate).slice(0, 10);
  if (input.result.status === "SEM_CUSTO") {
    return `Matéria-prima ${input.materialCode} em ${ref}: custo não resolvido.`;
  }
  return `Matéria-prima ${input.materialCode} em ${ref} usa ${input.result.versionName} v${input.result.revision}, landed R$ ${input.result.landedCostSnapshot.toFixed(6)}/${input.result.unitSnapshot}.`;
}

export function isMaterialCostVersionReadOnly(status: string | null | undefined): boolean {
  return String(status ?? "").toUpperCase() !== "DRAFT";
}
