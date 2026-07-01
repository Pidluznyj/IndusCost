/**
 * UI helpers — rastreabilidade custo congelado na Engenharia de Produto.
 */
import type { FrozenCostTraceStatus } from "./productEngineeringCostSnapshot.js";
import { frozenCostTraceStatusLabel } from "./productEngineeringCostSnapshot.js";
import { formatProductCiu } from "./productCostDisplay.js";

export type ProductFrozenCostSummary = {
  liveCiu: number | null;
  liveHash?: string | null;
  frozenCost: number | null;
  frozenVersionCode?: string | null;
  frozenVersionRevision?: number | null;
  frozenEffectiveDate?: string | null;
  frozenVersionId?: string | null;
  draftVersionId?: string | null;
  traceStatus: FrozenCostTraceStatus;
  traceStatusLabel?: string;
};

export function frozenCostTraceBadgeClass(status: FrozenCostTraceStatus): string {
  switch (status) {
    case "ATUALIZADO":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "PENDENTE_PUBLICACAO":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
    case "CUSTO_DIVERGENTE":
      return "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200";
    case "SEM_CUSTO_CONGELADO":
    case "SEM_CUSTO":
      return "bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function formatFrozenCostSummaryLine(summary: ProductFrozenCostSummary | undefined): string {
  if (!summary) return "—";
  const label = summary.traceStatusLabel ?? frozenCostTraceStatusLabel(summary.traceStatus);
  const frozen =
    summary.frozenCost != null && Number.isFinite(summary.frozenCost)
      ? formatProductCiu(summary.frozenCost)
      : "—";
  return `${label} · ${frozen}`;
}

export const FROZEN_COST_DIVERGENCE_ALERT =
  "O custo atual da engenharia difere do custo publicado. Gere ou publique uma nova versão para refletir a alteração em margens futuras.";

export const GRID_FROZEN_COST_COLUMN_LABEL = "Custo congelado";
export const GRID_FROZEN_COST_COLUMN_TOOLTIP =
  "Custo oficial versionado vigente (tabela de produção). Compare com CIU atual.";
