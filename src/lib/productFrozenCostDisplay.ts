/**
 * UI helpers — rastreabilidade custo congelado na Engenharia de Produto.
 */
import type { FrozenCostTraceStatus } from "./productEngineeringCostSnapshot.js";
import { frozenCostTraceStatusLabel } from "./productEngineeringCostSnapshot.js";
import { formatProductCiu } from "./productCostDisplay.js";
import {
  executiveAlertBadgeClass,
  frozenCostTraceToExecutiveVariant,
} from "./executiveAlertStyles.js";

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
  return executiveAlertBadgeClass(frozenCostTraceToExecutiveVariant(status));
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
