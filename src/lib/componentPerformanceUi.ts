import {
  COMPONENT_PERFORMANCE_EDIT_PERMISSIONS,
  COMPONENT_PERFORMANCE_VIEW_PERMISSIONS,
} from "@/src/lib/componentPerformancePermissions";
import type { PermissionChecker } from "@/src/lib/modulePermissions";

export const OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE =
  "Isso não altera custos publicados. A mudança será usada em novos DRAFTs de custo.";

export const OPERATIONS_PERFORMANCE_PAGE_DESCRIPTION =
  "Atualize ciclo, cavidades, setup e eficiência dos componentes. Alterações impactam apenas novas gerações de DRAFT de custo; custos publicados permanecem congelados.";

export type ComponentPerformanceFilterId =
  | "all"
  | "sold"
  | "pending"
  | "sold_missing"
  | "missing_cycle"
  | "missing_cavities"
  | "missing_process"
  | "recent";

export const COMPONENT_PERFORMANCE_FILTER_OPTIONS: ReadonlyArray<{
  id: ComponentPerformanceFilterId;
  label: string;
}> = [
  { id: "all", label: "Todos" },
  { id: "sold", label: "Vendidos" },
  { id: "pending", label: "Pendentes" },
  { id: "sold_missing", label: "Vendidos sem performance" },
  { id: "missing_cycle", label: "Sem ciclo" },
  { id: "missing_cavities", label: "Sem cavidades" },
  { id: "missing_process", label: "Processo incompleto" },
  { id: "recent", label: "Alterados recentemente" },
];

export function canViewComponentPerformance(check: PermissionChecker): boolean {
  return check.hasAnyPermission([
    ...COMPONENT_PERFORMANCE_VIEW_PERMISSIONS,
    "products.view",
  ]);
}

export function canEditComponentPerformance(check: PermissionChecker): boolean {
  return check.hasAnyPermission([
    ...COMPONENT_PERFORMANCE_EDIT_PERMISSIONS,
    "products.edit",
  ]);
}

export function validatePerformanceEditForm(input: {
  responsiblePersonName: string;
  cycleTimeSeconds: string;
  cavities: string;
  setupTimeMin: string;
  efficiencyExpected: string;
}): string | null {
  if (!input.responsiblePersonName.trim() || input.responsiblePersonName.trim().length < 2) {
    return "Informe o responsável pela alteração operacional.";
  }
  const cycle = Number(input.cycleTimeSeconds);
  if (!Number.isFinite(cycle) || cycle <= 0) {
    return "Informe um ciclo válido em segundos (maior que zero).";
  }
  const cav = Number(input.cavities);
  if (!Number.isFinite(cav) || cav < 1 || !Number.isInteger(cav)) {
    return "Informe cavidades válidas (inteiro maior ou igual a 1).";
  }
  if (!input.setupTimeMin.trim()) {
    return "Informe o setup em minutos (obrigatório, maior ou igual a zero).";
  }
  const setup = Number(input.setupTimeMin);
  if (!Number.isFinite(setup) || setup < 0) {
    return "Informe o setup em minutos (obrigatório, maior ou igual a zero).";
  }
  if (!input.efficiencyExpected.trim()) {
    return "Informe a eficiência (%) entre 0 (exclusive) e 100.";
  }
  const eff = Number(input.efficiencyExpected);
  if (!Number.isFinite(eff) || eff <= 0 || eff > 100) {
    return "Informe a eficiência (%) entre 0 (exclusive) e 100.";
  }
  return null;
}

export function formatPerformanceNumber(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatPerformanceDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}
