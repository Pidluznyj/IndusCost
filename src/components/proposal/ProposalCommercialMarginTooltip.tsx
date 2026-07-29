import React, { memo, useMemo } from "react";
import { Info } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildProposalCommercialMarginTooltipText,
} from "@/src/lib/proposalCommercialMarginDisplay";
import type { ProposalCommercialMarginItemPayload } from "@/src/lib/proposalCommercialMargin";

type Props = {
  item: ProposalCommercialMarginItemPayload;
  className?: string;
  testId?: string;
};

/** Tooltip interno da margem comercial do item da Proposta. */
export const ProposalCommercialMarginTooltip = memo(function ProposalCommercialMarginTooltip({
  item,
  className,
  testId = "proposal-commercial-margin-tooltip",
}: Props) {
  const text = useMemo(() => buildProposalCommercialMarginTooltipText(item), [item]);

  return (
    <span
      className={cn("inline-flex shrink-0 proposal-commercial-margin-tooltip-wrap", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex cursor-help rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="Detalhes da margem comercial"
        data-testid={`${testId}-trigger`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <div
        className="proposal-commercial-margin-tooltip-panel text-left whitespace-pre-line max-w-sm"
        role="tooltip"
        data-testid={testId}
      >
        {text}
      </div>
    </span>
  );
});
