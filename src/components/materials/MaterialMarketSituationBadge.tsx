import React from "react";
import { cn } from "@/src/lib/utils";
import {
  materialMarketSituationBadgeClass,
  type MaterialMarketSituationResult,
  type MaterialMarketSituationStatus,
} from "@/src/lib/materialMarketSituationStatus";

type Props = {
  situation: Pick<MaterialMarketSituationResult, "status" | "statusLabel" | "reason"> | null | undefined;
  compact?: boolean;
};

export function MaterialMarketSituationBadge({ situation, compact = false }: Props) {
  if (!situation) return null;

  const status = situation.status as MaterialMarketSituationStatus;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide cursor-help",
        materialMarketSituationBadgeClass(status)
      )}
      title={situation.reason}
      data-testid={`material-market-situation-badge-${status.toLowerCase()}`}
    >
      {compact ? situation.statusLabel.slice(0, 3) : situation.statusLabel}
    </span>
  );
}
