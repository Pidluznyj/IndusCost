import React from "react";
import { Link } from "react-router-dom";
import { MaterialsMarketIntelligenceMonitoredList } from "@/src/components/materials/MaterialsMarketIntelligenceMonitoredList";
import { MaterialsMarketGlobalIndicatorsSection } from "@/src/components/materials/MaterialsMarketGlobalIndicatorsSection";
import { MaterialsMarketIntelligenceAlertsPanel } from "@/src/components/materials/MaterialMarketAlertsList";
import { MaterialsMarketIntelligenceTopOpportunityCard } from "@/src/components/materials/MaterialsMarketIntelligenceTopOpportunityCard";
import { MaterialMarketAlertGlobalConfigPanel } from "@/src/components/materials/MaterialMarketAlertGlobalConfigPanel";
import { MATERIALS_MARKET_INTELLIGENCE_REPORTS_PATH } from "@/src/lib/materialsNavigation";

export const MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE =
  "Nenhuma matéria-prima monitorada ainda";

export function MaterialsMarketIntelligencePage() {
  return (
    <div className="space-y-8" data-testid="materials-market-intelligence-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suprimentos
          </p>
          <h3 className="text-lg font-bold tracking-tight text-foreground">Inteligência de Mercado</h3>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Acompanhe o Dólar PTAX, o Brent e matérias-primas estratégicas para apoiar compras, custos e
            decisões de engenharia.
          </p>
        </div>
        <Link
          to={MATERIALS_MARKET_INTELLIGENCE_REPORTS_PATH}
          className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent"
          data-testid="materials-market-intelligence-reports-link"
        >
          Relatório executivo
        </Link>
      </header>

      <MaterialsMarketGlobalIndicatorsSection />

      <section
        className="space-y-3"
        aria-labelledby="materials-market-intelligence-opportunity-heading"
        data-testid="materials-market-intelligence-opportunity-section"
      >
        <div>
          <h4
            id="materials-market-intelligence-opportunity-heading"
            className="text-sm font-semibold text-foreground"
          >
            Oportunidades
          </h4>
          <p className="text-xs text-muted-foreground">
            Destaques de economia potencial identificados nas cotações monitoradas.
          </p>
        </div>
        <MaterialsMarketIntelligenceTopOpportunityCard />
      </section>

      <MaterialsMarketIntelligenceAlertsPanel />

      <MaterialMarketAlertGlobalConfigPanel />

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
        <MaterialsMarketIntelligenceMonitoredList />
      </section>
    </div>
  );
}
