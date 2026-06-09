import React from "react";
import type { FinanceCashFlowDashboardPayload } from "@/src/lib/financeCashFlowDashboardTypes";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceCashFlowScenarioChart } from "@/src/components/finance/cash-flow/FinanceCashFlowScenarioChart";
import { FinanceCashFlowCashNeedPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowCashNeedPanel";
import { FinanceCashFlowDetailTable } from "@/src/components/finance/cash-flow/FinanceCashFlowDetailTable";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowRiskTab({ payload }: { payload: FinanceCashFlowDashboardPayload }) {
  const { executiveInsights, cashHealthScore, cards, cashForecast } = payload;
  return (
    <div className="space-y-6" data-testid="cash-flow-risk-tab">
      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Risco de Caixa</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Score, cenários, concentração e itens críticos — simulação gerencial
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <RiskMetric
            label="Score de saúde"
            value={`${cashHealthScore.score}/100`}
            sub={cashHealthScore.classificationLabel}
            tone={cashHealthScore.classification}
          />
          <RiskMetric
            label="Meses negativos (12m)"
            value={String(cashForecast.horizons.next12Months.negativeMonthsCount)}
            sub="Horizonte projetado"
          />
          <RiskMetric
            label="Necessidade conservadora"
            value={formatFinanceCurrency(payload.conservativeScenario.cashNeedConservative)}
            sub="80% recebíveis realizáveis"
          />
          <RiskMetric
            label="Necessidade crítica"
            value={formatFinanceCurrency(payload.stressScenario.cashNeedStress)}
            sub={`${payload.stressScenario.monthsAtRiskStress} mês(es) em risco`}
            tone="critical"
          />
        </div>
      </section>

      <FinanceCashFlowScenarioChart points={payload.scenarioChartPoints} />
      <FinanceCashFlowCashNeedPanel
        cards={cards}
        cashForecast={cashForecast}
        conservativeScenario={payload.conservativeScenario}
        stressScenario={payload.stressScenario}
      />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${financeBiCardClass} p-5 space-y-3`}>
          <h3 className="text-sm font-bold text-[#111827]">Concentração</h3>
          <ConcentrationRow
            label="Maior cliente"
            party={executiveInsights.diagnostics.concentration.topCustomer}
            alert={executiveInsights.diagnostics.concentration.customerAlert}
            inflow
          />
          <ConcentrationRow
            label="Maior fornecedor"
            party={executiveInsights.diagnostics.concentration.topSupplier}
            alert={executiveInsights.diagnostics.concentration.supplierAlert}
            outflow
          />
        </div>
        <div className={`${financeBiCardClass} p-5 space-y-3`}>
          <h3 className="text-sm font-bold text-[#111827]">Ações recomendadas</h3>
          {executiveInsights.recommendedActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ação prioritária.</p>
          ) : (
            <ol className="space-y-2 list-decimal list-inside text-sm text-[#374151]">
              {executiveInsights.recommendedActions.map((a) => (
                <li key={a.title}>
                  <span className="font-semibold">{a.title}</span>
                  {a.suggestedAction ? (
                    <span className="block text-[11px] text-[#6B7280] ml-5">{a.suggestedAction}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <FinanceCashFlowDetailTable
        inflows={payload.overdueReceivables}
        outflows={[...payload.overduePayables, ...payload.largestProjectedOutflows]}
      />
    </div>
  );
}

function RiskMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className={`${financeBiCardClass} p-4 space-y-1`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p
        className={cn(
          "text-xl font-bold tabular-nums",
          tone === "critical" || tone === "risk"
            ? "text-[#DC2626]"
            : tone === "healthy"
              ? "text-[#059669]"
              : "text-[#111827]"
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-[#6B7280]">{sub}</p>
    </div>
  );
}

function ConcentrationRow({
  label,
  party,
  alert,
  inflow = false,
  outflow = false,
}: {
  label: string;
  party: { personName: string | null; amount: number; percentOfTotal: number } | null;
  alert: boolean;
  inflow?: boolean;
  outflow?: boolean;
}) {
  if (!party) {
    return <p className="text-sm text-muted-foreground">{label}: sem dados.</p>;
  }
  return (
    <div className="flex justify-between gap-2 text-sm">
      <div>
        <p className="font-medium text-[#111827]">
          {label}: {party.personName?.trim() || "—"}
        </p>
        <p className={cn("text-[11px]", alert ? "text-amber-700 font-semibold" : "text-[#6B7280]")}>
          {party.percentOfTotal.toFixed(1)}% do total{alert ? " — acima do limite" : ""}
        </p>
      </div>
      <span
        className={cn(
          "font-bold tabular-nums shrink-0",
          outflow ? "text-[#DC2626]" : inflow ? "text-[#059669]" : "text-[#111827]"
        )}
      >
        {formatFinanceCurrency(party.amount)}
      </span>
    </div>
  );
}
