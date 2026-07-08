import React from "react";
import { MaterialsMarketIntelligenceMonitoredList } from "@/src/components/materials/MaterialsMarketIntelligenceMonitoredList";
import { MaterialsMarketIntelligenceAlertsPanel } from "@/src/components/materials/MaterialMarketAlertsList";
import { MaterialsMarketIntelligenceTopOpportunityCard } from "@/src/components/materials/MaterialsMarketIntelligenceTopOpportunityCard";

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
        <MaterialsMarketIntelligenceTopOpportunityCard />
      </section>

      <MaterialsMarketIntelligenceAlertsPanel />

      <section
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
        <MaterialsMarketIntelligenceMonitoredList />
      </section>
    </div>
  );
}
