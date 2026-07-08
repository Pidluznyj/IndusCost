import React from "react";
import { Receipt } from "lucide-react";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import {
  formatMaterialIntelligenceQuoteDate,
  MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE,
} from "@/src/lib/materialIntelligence360Sections";
import { formatCurrency } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";
import { MaterialIntelligenceMarketQuoteForm } from "@/src/components/materials/MaterialIntelligenceMarketQuoteForm";

type Props = {
  materialId: string;
  defaultUnit: string;
  quotes: MaterialMarketQuoteApiItem[];
  loading?: boolean;
  onQuoteCreated: () => void;
};

export function MaterialIntelligenceRecentQuotesSection({
  materialId,
  defaultUnit,
  quotes,
  loading = false,
  onQuoteCreated,
}: Props) {
  return (
    <MaterialIntelligence360Section
      id="recentQuotes"
      title="Últimas Cotações"
      description="Cotações manuais de mercado registradas para esta matéria-prima."
    >
      <MaterialIntelligenceMarketQuoteForm
        materialId={materialId}
        defaultUnit={defaultUnit}
        onCreated={onQuoteCreated}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Carregando cotações…</p>
      ) : quotes.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-recent-quotes-empty"
        >
          <Receipt className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            {MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use o formulário acima para registrar a primeira cotação manual.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm" data-testid="material-intelligence-market-quotes-table">
            <thead>
              <tr className="border-b border-border bg-accent/40">
                <th className="p-3 font-semibold">Data</th>
                <th className="p-3 font-semibold">Fornecedor</th>
                <th className="p-3 font-semibold text-right">Preço base</th>
                <th className="p-3 font-semibold text-right">Líquido</th>
                <th className="p-3 font-semibold">Unid.</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quotes.map((quote) => (
                <tr key={quote.id} data-testid={`material-market-quote-row-${quote.id}`}>
                  <td className="p-3 text-muted-foreground">
                    {formatMaterialIntelligenceQuoteDate(quote.quoteDate)}
                  </td>
                  <td className="p-3">
                    <span className="font-medium">{quote.supplierName ?? "—"}</span>
                    {quote.origin ? (
                      <p className="text-xs text-muted-foreground">{quote.origin}</p>
                    ) : null}
                  </td>
                  <td className="p-3 text-right">
                    {formatCurrency(quote.price)} {quote.currency}
                  </td>
                  <td className="p-3 text-right font-semibold text-primary">
                    {formatCurrency(quote.netPrice)}
                  </td>
                  <td className="p-3 text-muted-foreground">{quote.unit}</td>
                  <td className="p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {quote.statusLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {quotes.length} cotação(ões) — ordenadas da mais recente para a mais antiga.
          </p>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
