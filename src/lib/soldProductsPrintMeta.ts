import { soldProductsFilterSummaryLines } from "@/src/lib/salesProductRankingFilters.js";
import type {
  SoldProductsDashboardFiltersApplied,
  SoldProductsSummary,
} from "@/src/lib/salesProductRankingTypes.js";

export const SOLD_PRODUCTS_PRINT_TITLE = "Relatório de Produtos Vendidos";
export const SOLD_PRODUCTS_PRINT_SUBTITLE =
  "Ranking gerencial por pedidos de venda · base Nomus";
export const SOLD_PRODUCTS_PRINT_FOOTER_NOTE =
  "Quantidades e valores conforme filtros aplicados. Cancelados/erro respeitam o status selecionado.";

export { PRINT_COMPANY_DOC_FALLBACK as SOLD_PRODUCTS_COMPANY_DOC_FALLBACK } from "@/src/lib/printBranding";

export function formatSoldProductsPrintDateTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

export function formatSoldProductsPrintDate(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const normalized = value.trim();
  const d = normalized.includes("T")
    ? new Date(normalized)
    : new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(d.getTime())) return normalized;
  return d.toLocaleDateString("pt-BR");
}

export function formatSoldProductsPrintQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const hasFraction = Math.abs(value - Math.round(value)) > 1e-9;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function formatSoldProductsPrintMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatSoldProductsPrintPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function buildSoldProductsPrintFilterSummary(
  applied: SoldProductsDashboardFiltersApplied
): string {
  return soldProductsFilterSummaryLines(applied).join(" · ");
}

export function formatSoldProductsPrintLeader(
  leader: SoldProductsSummary["topProductByQuantity"]
): string {
  if (!leader) return "—";
  const code = leader.productCode?.trim();
  return code ? `${code} — ${leader.productName}` : leader.productName;
}
