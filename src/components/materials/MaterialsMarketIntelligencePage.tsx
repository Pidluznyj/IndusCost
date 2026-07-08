import React from "react";
import { LineChart } from "lucide-react";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";

export const MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE =
  "Nenhuma matéria-prima monitorada ainda";

export function MaterialsMarketIntelligencePage() {
  return (
    <div className="space-y-8" data-testid="materials-market-intelligence-page">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Suprimentos
        </p>
        <h3 className="text-lg font-bold tracking-tight text-foreground">Inteligência de Mercado</h3>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Acompanhe matérias-primas estratégicas e sinais de mercado para apoiar compras, custos e
          decisões de engenharia. Nesta fase inicial, configure o monitoramento quando estiver
          disponível.
        </p>
      </header>

      <section
        className="space-y-3"
        aria-labelledby="materials-market-intelligence-kpis-heading"
        data-testid="materials-market-intelligence-kpis-section"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4
              id="materials-market-intelligence-kpis-heading"
              className="text-sm font-semibold text-foreground"
            >
              Indicadores
            </h4>
            <p className="text-xs text-muted-foreground">
              Resumo executivo das matérias monitoradas e variações relevantes.
            </p>
          </div>
        </div>
        <div
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center"
          data-testid="materials-market-intelligence-kpis-placeholder"
        >
          <LineChart className="mb-3 h-8 w-8 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            Os indicadores de mercado serão exibidos nesta área.
          </p>
        </div>
      </section>

      <section
        className="space-y-3"
        aria-labelledby="materials-market-intelligence-list-heading"
        data-testid="materials-market-intelligence-list-section"
      >
        <div>
          <h4
            id="materials-market-intelligence-list-heading"
            className="text-sm font-semibold text-foreground"
          >
            Matérias-primas monitoradas
          </h4>
          <p className="text-xs text-muted-foreground">
            Lista das matérias acompanhadas e seus últimos sinais registrados.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ContextualDashboardEmpty message={MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE} />
        </div>
      </section>
    </div>
  );
}
