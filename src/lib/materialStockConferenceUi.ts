/**
 * Helpers e contratos de UI — Conferência de estoque (tablet/desktop).
 * Sem custos / BOM / fornecedor.
 */
import {
  computeAvailableAboveContingency,
  computeReplenishmentSuggestion,
  MATERIAL_STOCK_STATUS_LABELS,
  type MaterialStockStatus,
} from "./materialStockLevelRules.js";
import type { MaterialStockTabletListItem } from "./materialStockTabletTypes.js";

export const MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE =
  "Nenhuma matéria-prima encontrada para conferência.";

export const MATERIAL_STOCK_CONFERENCE_SELECT_HINT =
  "Selecione uma matéria-prima na lista para ver os detalhes.";

export const MATERIAL_STOCK_CONFERENCE_PAGE_TITLE = "Conferência de estoque";

export type MaterialStockConferenceLayoutMode = "split" | "stacked";

/** Desktop / tablet horizontal → split; tablet vertical / mobile → stacked. */
export function resolveMaterialStockConferenceLayout(input: {
  width: number;
  orientation: "portrait" | "landscape";
}): MaterialStockConferenceLayoutMode {
  if (input.width < 768) return "stacked";
  if (input.orientation === "portrait" && input.width < 1200) return "stacked";
  return "split";
}

export function formatStockConferenceQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatStockConferenceDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function stockConferenceStatusLabel(status: MaterialStockStatus | string): string {
  if (status in MATERIAL_STOCK_STATUS_LABELS) {
    return MATERIAL_STOCK_STATUS_LABELS[status as MaterialStockStatus];
  }
  return String(status);
}

/** Explicação resumida do status — texto independente da cor. */
export const MATERIAL_STOCK_STATUS_EXPLANATIONS: Record<MaterialStockStatus, string> = {
  NAO_CONFIGURADO:
    "Parâmetros incompletos ou hierarquia inválida. Contingência, mínimo e recomendado não somam ao estoque.",
  SEM_ESTOQUE: "Estoque atual zerado.",
  EMERGENCIA: "Estoque abaixo da contingência — prioridade máxima de reposição.",
  CRITICO: "Estoque abaixo do mínimo operacional.",
  ATENCAO: "Estoque abaixo do recomendado — planejar reposição.",
  SAUDAVEL: "Estoque no nível recomendado ou acima.",
};

export type MaterialStockStatusVisual = {
  status: MaterialStockStatus;
  label: string;
  explanation: string;
  /** Nome de ícone Lucide para a UI. */
  icon: "help-circle" | "ban" | "flame" | "alert-triangle" | "alert-circle" | "check-circle";
  tone: "muted" | "neutral" | "danger" | "warning" | "caution" | "success";
};

export function resolveMaterialStockStatusVisual(
  status: MaterialStockStatus | string
): MaterialStockStatusVisual {
  const normalized =
    status in MATERIAL_STOCK_STATUS_LABELS
      ? (status as MaterialStockStatus)
      : "NAO_CONFIGURADO";
  const icons: Record<MaterialStockStatus, MaterialStockStatusVisual["icon"]> = {
    NAO_CONFIGURADO: "help-circle",
    SEM_ESTOQUE: "ban",
    EMERGENCIA: "flame",
    CRITICO: "alert-triangle",
    ATENCAO: "alert-circle",
    SAUDAVEL: "check-circle",
  };
  const tones: Record<MaterialStockStatus, MaterialStockStatusVisual["tone"]> = {
    NAO_CONFIGURADO: "muted",
    SEM_ESTOQUE: "neutral",
    EMERGENCIA: "danger",
    CRITICO: "warning",
    ATENCAO: "caution",
    SAUDAVEL: "success",
  };
  return {
    status: normalized,
    label: stockConferenceStatusLabel(normalized),
    explanation: MATERIAL_STOCK_STATUS_EXPLANATIONS[normalized],
    icon: icons[normalized],
    tone: tones[normalized],
  };
}

export function deriveStockConferenceMetrics(item: MaterialStockTabletListItem): {
  availableAboveContingency: number | null;
  replenishmentSuggestion: number | null;
} {
  return {
    availableAboveContingency: computeAvailableAboveContingency(
      item.currentQuantity,
      item.contingencyQuantity
    ),
    replenishmentSuggestion: computeReplenishmentSuggestion(
      item.currentQuantity,
      item.recommendedQuantity
    ),
  };
}

/** Editar parâmetros exige update em engineering.materials (API PATCH). */
export function canEditMaterialStockParameters(input: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  effectivePermissions?: readonly string[] | null;
  role?: string | null;
}): boolean {
  if (input.role === "SUPER_ADMIN" || input.role === "ADMIN") return true;
  if (input.canPerformAction?.("engineering.materials", "update")) return true;
  const bag = input.effectivePermissions ?? [];
  return bag.includes("materials.edit");
}

/** Garante que payloads/UI de operador não vazem custo. */
export const MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS = [
  "currentCost",
  "averageCost",
  "standardCost",
  "freight",
  "standardLoss",
  "landedCost",
  "effectiveCost",
  "totalMaterialValue",
  "calculations",
] as const;
