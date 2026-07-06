import React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Shield,
  Target,
  TrendingDown,
} from "lucide-react";
import type { FinanceCashFlowExecutiveInsights } from "@/src/lib/financeCashFlowCfoDiagnostics";
import type { CashFlowInsightItem, CashFlowInsightSeverity } from "@/src/lib/financeCashFlowCfoDiagnostics";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

function healthColor(classification: string): string {
  if (classification === "healthy") return "text-[#059669]";
  if (classification === "attention") return "text-[#D97706]";
  if (classification === "risk") return "text-[#EA580C]";
  return "text-[#DC2626]";
}

function healthBg(classification: string): string {
  if (classification === "healthy") return "border-emerald-200 bg-emerald-50/50";
  if (classification === "attention") return "border-amber-200 bg-amber-50/50";
  if (classification === "risk") return "border-orange-200 bg-orange-50/50";
  return "border-red-200 bg-red-50/50";
}

function severityClass(severity: CashFlowInsightSeverity): string {
  if (severity === "critical") return "border-l-red-500 bg-red-50/40";
  if (severity === "warning") return "border-l-amber-500 bg-amber-50/40";
  if (severity === "success") return "border-l-emerald-500 bg-emerald-50/40";
  return "border-l-[#2563EB] bg-[#F9FAFB]";
}

function InsightList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: CashFlowInsightItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className={`${financeBiCardClass} p-4`}>
        <h4 className="text-sm font-bold text-[#111827] mb-2">{title}</h4>
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className={`${financeBiCardClass} p-4 space-y-2`}>
      <h4 className="text-sm font-bold text-[#111827]">{title}</h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.title}
            className={cn("rounded-lg border-l-4 px-3 py-2 text-sm", severityClass(item.severity))}
          >
            <p className="font-semibold text-[#111827]">{item.title}</p>
            <p className="text-[#374151] mt-0.5 leading-snug">{item.description}</p>
            {item.suggestedAction ? (
              <p className="text-[11px] text-[#6B7280] mt-1">→ {item.suggestedAction}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FinanceCashFlowCfoPanel({ insights }: { insights: FinanceCashFlowExecutiveInsights }) {
  const { cashHealthScore, diagnostics, summary } = insights;
  const cls = cashHealthScore.classification;

  return (
    <section className={financeBiSectionClass} data-testid="cash-flow-cfo-panel">
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-sm font-bold text-[#111827]">Diagnóstico Financeiro</h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          Painel CFO — saúde, riscos e plano de ação com base nos dados filtrados
        </p>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            className={cn("rounded-xl border p-5 space-y-2 lg:col-span-1", healthBg(cls))}
            data-testid="cash-health-score"
          >
            <div className="flex items-center gap-2">
              <Shield className={cn("h-5 w-5", healthColor(cls))} />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                Saúde do caixa
              </span>
            </div>
            <p className={cn("text-4xl font-bold tabular-nums", healthColor(cls))}>
              {cashHealthScore.score}
              <span className="text-lg font-semibold text-[#6B7280]">/100</span>
            </p>
            <p className={cn("text-sm font-bold", healthColor(cls))}>
              {cashHealthScore.classificationLabel}
            </p>
            <p className="text-sm text-[#374151] leading-relaxed">{cashHealthScore.explanation}</p>
          </div>

          <div className={`${financeBiCardClass} p-4 lg:col-span-2 space-y-2`}>
            <p className="text-sm font-semibold text-[#111827]">Resumo executivo</p>
            <p className="text-sm text-[#374151] leading-relaxed">{summary}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {diagnostics.shortTermRisk.map((w) => (
            <div key={w.days} className={`${financeBiCardClass} p-3 space-y-1`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                {w.label}
              </p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  w.status === "negative"
                    ? "text-[#DC2626]"
                    : w.status === "positive"
                      ? "text-[#059669]"
                      : "text-[#6B7280]"
                )}
              >
                {formatFinanceCurrency(w.projectedNet)}
              </p>
              <p className="text-[10px] text-[#6B7280]">
                +{formatFinanceCurrency(w.projectedInflow)} / −
                {formatFinanceCurrency(w.projectedOutflow)}
              </p>
            </div>
          ))}
          <div className={`${financeBiCardClass} p-3 space-y-1`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Concentração
            </p>
            {diagnostics.concentration.customerAlert || diagnostics.concentration.supplierAlert ? (
              <p className="text-sm text-amber-800 font-medium flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Acima de 40%
              </p>
            ) : (
              <p className="text-sm text-[#059669] font-medium">Dentro do limite</p>
            )}
            {diagnostics.concentration.topCustomer ? (
              <p className="text-[10px] text-[#6B7280]">
                Cliente: {diagnostics.concentration.topCustomer.percentOfTotal.toFixed(1)}%
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${financeBiCardClass} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <h4 className="text-sm font-bold text-[#111827]">Pressão de pagamentos</h4>
            </div>
            <MiniMovementList
              items={diagnostics.paymentPressure.overduePayables}
              outflow
              empty="Nenhum pagamento vencido nos filtros."
            />
          </div>
          <div className={`${financeBiCardClass} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <ArrowDownRight className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-bold text-[#111827]">Oportunidade de cobrança</h4>
            </div>
            <MiniMovementList
              items={diagnostics.collectionOpportunity.overdueReceivables}
              empty="Nenhum vencido a receber nos filtros."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <InsightList
            title="Alertas"
            items={insights.alerts.slice(0, 5)}
            emptyLabel="Nenhum alerta crítico no momento."
          />
          <InsightList
            title="Oportunidades"
            items={insights.opportunities.slice(0, 5)}
            emptyLabel="Nenhuma oportunidade identificada."
          />
          <div className={`${financeBiCardClass} p-4 space-y-2`}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[#2563EB]" />
              <h4 className="text-sm font-bold text-[#111827]">Plano de ação</h4>
            </div>
            {insights.recommendedActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ação prioritária.</p>
            ) : (
              <ol className="space-y-2 list-decimal list-inside">
                {insights.recommendedActions.map((item) => (
                  <li key={item.title} className="text-sm text-[#374151] leading-snug">
                    <span className="font-semibold text-[#111827]">{item.title}</span>
                    {item.relatedAmount != null ? (
                      <span className="text-[#6B7280]">
                        {" "}
                        — {formatFinanceCurrency(item.relatedAmount)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {insights.watchItems.length > 0 ? (
          <div className={`${financeBiCardClass} p-4`} data-testid="cash-flow-watchlist">
            <h4 className="text-sm font-bold text-[#111827] mb-2">Watchlist</h4>
            <ul className="space-y-1">
              {insights.watchItems.map((item) => (
                <li key={item.title} className="text-sm text-[#374151] flex gap-2">
                  <ArrowUpRight className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{item.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MiniMovementList({
  items,
  outflow = false,
  empty,
}: {
  items: Array<{ personName: string | null; amount: number; daysOverdue?: number }>;
  outflow?: boolean;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 4).map((item, idx) => (
        <li key={idx} className="flex justify-between gap-2 text-sm">
          <span className="truncate text-[#111827]">{item.personName?.trim() || "—"}</span>
          <span
            className={cn(
              "shrink-0 font-bold tabular-nums",
              outflow ? "text-[#DC2626]" : "text-[#059669]"
            )}
          >
            {outflow ? "−" : "+"}
            {formatFinanceCurrency(item.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
