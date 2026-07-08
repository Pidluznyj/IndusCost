import React from "react";
import { Receipt } from "lucide-react";
import type { MaterialIntelligenceQuoteRow } from "@/src/lib/materialMarketIntelligenceDetail";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "@/src/lib/materialIntelligence360Sections";
import { formatCurrency } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

type Props = {
  quotes: MaterialIntelligenceQuoteRow[];
};

export function MaterialIntelligenceRecentQuotesSection({ quotes }: Props) {
  return (
    <MaterialIntelligence360Section
      id="recentQuotes"
      title="Últimas Cotações"
      description="Cotações mais recentes registradas no histórico de preços."
    >
      {quotes.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-recent-quotes-empty"
        >
          <Receipt className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            {MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Registre cotações no histórico de preços da matéria-prima para acompanhá-las aqui.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-accent/40">
                <th className="p-3 font-semibold">Data</th>
                <th className="p-3 font-semibold text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((quote, index) => (
                <tr key={`${quote.date ?? "na"}-${index}`}>
                  <td className="p-3 text-muted-foreground">
                    {formatMaterialIntelligenceQuoteDate(quote.date)}
                  </td>
                  <td className="p-3 text-right font-medium">{formatCurrency(quote.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
