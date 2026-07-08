import React from "react";
import {
  MATERIAL_MARKET_QUOTE_RELIABILITY_BADGE_CLASSES,
  MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS,
  type MaterialMarketQuoteReliabilityLevel,
} from "@/src/lib/materialMarketQuoteReliability";

type Props = {
  level: MaterialMarketQuoteReliabilityLevel;
  suggestedLevel?: MaterialMarketQuoteReliabilityLevel | null;
  showSuggestionHint?: boolean;
  className?: string;
};

export function MaterialIntelligenceQuoteReliabilityBadge({
  level,
  suggestedLevel,
  showSuggestionHint = true,
  className = "",
}: Props) {
  const differs =
    showSuggestionHint &&
    suggestedLevel != null &&
    suggestedLevel !== level;

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${MATERIAL_MARKET_QUOTE_RELIABILITY_BADGE_CLASSES[level]}`}
        data-testid={`material-quote-reliability-badge-${level}`}
        title={MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[level]}
      >
        {MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[level]}
      </span>
      {differs ? (
        <span
          className="text-[10px] text-muted-foreground"
          data-testid="material-quote-reliability-suggestion-hint"
          title={`Sugestão automática: ${MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[suggestedLevel]}`}
        >
          Sug.: {MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[suggestedLevel]}
        </span>
      ) : null}
    </span>
  );
}
