/**
 * Labels e formatação de UI — tabelas oficiais de custo de produção (sem Prisma).
 */
import type { EffectiveProductProductionCostResult } from "./productionCostVersioning.js";

export const PRODUCTION_COST_TABLE_VIEW_PERMISSIONS = [
  "pricing.view",
  "pricing.generate_tables",
  "settings.price_tables.view",
  "costs.view",
  "products.tab.cost",
] as const;

export const PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS = [
  "pricing.generate_tables",
  "settings.price_tables.manage",
] as const;

export const PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS = [
  "pricing.publish_tables",
  "settings.price_tables.manage",
] as const;

export const PRODUCTION_COST_IMMUTABLE_NOTICE =
  "Versões publicadas são fotos oficiais e não podem ser editadas. Correções devem gerar nova revisão.";

export const PRODUCTION_COST_DISPLAY_LABELS = {
  saleUnitPrice: "Preço unitário de venda",
  productionUnitCost: "Custo de produção IndusCost",
  productionTotalCost: "Custo total de produção",
  costTableSource: "Tabela de custo vigente",
  costUnresolved: "Custo não resolvido",
  effectiveCostLookup: "Consulta de custo vigente",
} as const;

export type ProductionCostVersionStatusUi =
  | "DRAFT"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "ARCHIVED";

export function formatProductionCostVersionStatusLabel(
  status: string | null | undefined
): string {
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

export function productionCostVersionStatusBadgeClass(
  status: string | null | undefined
): string {
  switch (String(status ?? "").toUpperCase()) {
    case "DRAFT":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
    case "PUBLISHED":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "SUPERSEDED":
      return "bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
    case "ARCHIVED":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function formatCivilDatePtBrFromIso(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const raw = iso instanceof Date ? iso.toISOString() : String(iso);
  const parts = raw.trim().slice(0, 10).split("-");
  if (parts.length !== 3) return raw;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatEffectiveProductionCostSummary(input: {
  productCode: string;
  referenceDate: string | Date;
  result: EffectiveProductProductionCostResult;
}): string {
  const refLabel = formatCivilDatePtBrFromIso(input.referenceDate);
  if (input.result.status === "SEM_CUSTO") {
    return `Item ${input.productCode} em ${refLabel}: ${PRODUCTION_COST_DISPLAY_LABELS.costUnresolved}.`;
  }
  const tableLabel = `${input.result.versionName} v${input.result.revision}`;
  const vigLabel = formatCivilDatePtBrFromIso(input.result.effectiveDate);
  return `Item ${input.productCode} em ${refLabel} usa ${tableLabel}, vigência ${vigLabel}.`;
}

export function isProductionCostVersionReadOnly(status: string | null | undefined): boolean {
  return String(status ?? "").toUpperCase() !== "DRAFT";
}
