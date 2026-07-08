import React from "react";
import { LineChart } from "lucide-react";
import type { MaterialIntelligenceDetailItem } from "@/src/lib/materialMarketIntelligenceDetail";
import { MATERIAL_MARKET_CRITICALITY_LABELS } from "@/src/lib/materialMarketMonitoring";
import { MaterialMarketMonitoringBadge } from "@/src/components/materials/MaterialMarketMonitoringBadge";
import { MaterialMarketSituationBadge } from "@/src/components/materials/MaterialMarketSituationBadge";
import { SummaryKpiCard } from "@/src/components/ui/SummaryKpiCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCurrency } from "@/src/lib/utils";
import { formatMaterialIntelligenceQuoteDate } from "@/src/lib/materialIntelligence360Sections";

type Props = {
  item: MaterialIntelligenceDetailItem;
};

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export function MaterialIntelligence360Header({ item }: Props) {
  const criticalityLabel = item.marketCriticality
    ? MATERIAL_MARKET_CRITICALITY_LABELS[item.marketCriticality]
    : "—";

  return (
    <header
      className="rounded-2xl border border-border bg-card p-6 space-y-5"
      data-testid="material-intelligence-360-header"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inteligência de Mercado · Visão 360º
          </p>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <LineChart className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {item.code}
              </p>
              <h2 className="text-xl font-bold tracking-tight text-foreground">{item.description}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {item.family} · {item.unit}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <MaterialMarketMonitoringBadge
            isMarketMonitored={item.isMarketMonitored}
            marketCriticality={item.marketCriticality}
          />
          {item.isMarketMonitored ? (
            <MaterialMarketSituationBadge situation={item.marketSituation} />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 border-t border-border pt-5">
        <DetailField label="Grupo / Família" value={item.family} />
        <DetailField label="Unidade" value={item.unit} />
        <DetailField label="Criticidade" value={criticalityLabel} />
        <DetailField
          label="Situação de mercado"
          value={<MaterialMarketSituationBadge situation={item.marketSituation} />}
        />
        <DetailField label="Status de monitoramento" value={item.monitoringStatusLabel} />
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Observações estratégicas
        </p>
        <p
          className="text-sm text-foreground whitespace-pre-wrap"
          data-testid="material-intelligence-360-strategic-notes"
        >
          {item.marketNotes?.trim() || "Nenhuma observação estratégica registrada."}
        </p>
      </div>

      <SummaryKpiGrid testId="material-intelligence-360-kpis">
        {item.officialQuote ? (
          <SummaryKpiCard
            label="Cotação oficial"
            value={
              item.officialQuote.priceBrl != null
                ? formatCurrency(item.officialQuote.priceBrl)
                : "—"
            }
            description={`${item.officialQuote.supplierName ?? "Fornecedor não informado"} · ${
              item.officialQuote.quoteDate
                ? formatMaterialIntelligenceQuoteDate(item.officialQuote.quoteDate)
                : "—"
            }`}
            helperText="Cotação oficial"
          />
        ) : (
          <SummaryKpiCard
            label="Cotação oficial"
            value="Não definida"
            helperText="Defina uma cotação de referência na lista abaixo"
          />
        )}
        <SummaryKpiCard
          label="Última cotação"
          value={
            item.lastQuoteAmount != null
              ? formatCurrency(item.lastQuoteAmount)
              : "Sem cotação"
          }
          helperText={
            item.lastQuoteDate
              ? formatMaterialIntelligenceQuoteDate(item.lastQuoteDate)
              : "Aguardando registro"
          }
        />
        <SummaryKpiCard
          label="Frequência de monitoramento"
          value={
            item.isMarketMonitored && item.marketMonitoringFrequencyDays
              ? `${item.marketMonitoringFrequencyDays} dias`
              : "—"
          }
          helperText={
            item.isMarketMonitored ? "Intervalo configurado" : "Ative o monitoramento"
          }
        />
        <SummaryKpiCard
          label="Cotações registradas"
          value={String(item.recentQuotes.length)}
          helperText="No histórico recente"
        />
        <SummaryKpiCard
          label="Fornecedor cadastral"
          value={item.supplier || "Não informado"}
          helperText="Dado do cadastro de materiais"
        />
      </SummaryKpiGrid>
    </header>
  );
}
