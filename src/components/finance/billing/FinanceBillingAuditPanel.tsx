import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AdminKpiSection } from "@/src/components/admin/adminUi";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { formatExecutiveCurrency, formatExecutiveInteger } from "@/src/lib/executiveDashboardFormatters";
import type { BillingAuditResult } from "@/src/lib/financeBillingAuditTypes";
import { FinanceApErrorBanner, FinanceApLoadingBlock } from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { cn } from "@/src/lib/utils";

type ViewMode = "included" | "excluded" | "all";

type Props = {
  audit: BillingAuditResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function FinanceBillingAuditPanel({ audit, loading, error, onRetry }: Props) {
  const [view, setView] = useState<ViewMode>("included");

  const rows = useMemo(() => {
    if (!audit) return [];
    if (view === "included") return audit.includedRows;
    if (view === "excluded") return audit.excludedRows;
    return [...audit.includedRows, ...audit.excludedRows];
  }, [audit, view]);

  if (loading && !audit) {
    return <FinanceApLoadingBlock label="auditoria de faturamento" />;
  }

  if (error) {
    return <FinanceApErrorBanner message={error} onRetry={onRetry} />;
  }

  if (!audit) {
    return (
      <p className="text-sm text-muted-foreground">
        Clique em &quot;Auditar base do faturamento&quot; para carregar a composição do cálculo.
      </p>
    );
  }

  const { summary } = audit;

  return (
    <div className="space-y-5">
      {summary.excludedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Há registros excluídos ou fora do período que podem explicar divergência com o Nomus.
            Exporte a auditoria para comparar.
          </p>
        </div>
      ) : null}

      <AdminKpiSection
        title="Comparação NF-e fiscal × SalesOrder"
        eyebrow="Auditoria de faturamento"
        minColumnWidth={200}
        testId="finance-billing-audit-source-kpi"
      >
        <MetricCard
          label="Total NF-e fiscal"
          value={formatExecutiveCurrency(summary.nfeFiscalTotal)}
          variant="money"
        />
        <MetricCard
          label="Total SalesOrder"
          value={formatExecutiveCurrency(summary.salesOrderTotal)}
          variant="money"
        />
        <MetricCard
          label="Diferença (NF-e − pedidos)"
          value={formatExecutiveCurrency(summary.sourceComparisonDifference)}
          variant={Math.abs(summary.sourceComparisonDifference) > 0 ? "warning" : "success"}
        />
      </AdminKpiSection>

      {audit.divergences.some((d) => d.nfNumber === "7052") ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <strong>NF 7052</strong> — 08/06/2026 — R$ 168.075,00: presente na base NF-e fiscal,
          ausente no total por SalesOrder.
        </p>
      ) : null}
      {audit.dailySourceComparison.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Dia</th>
                <th className="px-3 py-2 text-right">NF-e</th>
                <th className="px-3 py-2 text-right">SalesOrder</th>
                <th className="px-3 py-2 text-right">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {audit.dailySourceComparison.map((row) => (
                <tr
                  key={row.date}
                  className={cn(
                    "border-b border-border/60",
                    Math.abs(row.difference) > 10000 && "bg-amber-50/60"
                  )}
                >
                  <td className="px-3 py-2">{row.date}</td>
                  <td className="px-3 py-2 text-right">{formatExecutiveCurrency(row.nfeTotal)}</td>
                  <td className="px-3 py-2 text-right">
                    {formatExecutiveCurrency(row.salesOrderTotal)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatExecutiveCurrency(row.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <AdminKpiSection
        title="Diagnóstico do cálculo"
        eyebrow={`Fonte: ${summary.dataSourceOfficial} · ${summary.periodLabel}`}
        minColumnWidth={168}
        testId="finance-billing-audit-diag-kpi"
        footer={
          <p className="text-[11px] text-muted-foreground">
            Data base: <strong>{summary.dateBaseLabel}</strong> · Valor:{" "}
            <strong>{summary.valueFieldLabel}</strong>
          </p>
        }
      >
        <MetricCard
          label="Total dashboard"
          value={formatExecutiveCurrency(summary.dashboardDisplayedTotal)}
          variant="money"
        />
        <MetricCard
          label="Total bruto encontrado"
          value={formatExecutiveCurrency(summary.grossFoundTotal)}
          variant="info"
        />
        <MetricCard
          label="Total excluído"
          value={formatExecutiveCurrency(summary.excludedTotal)}
          variant="warning"
        />
        <MetricCard
          label="NF incluídas"
          value={formatExecutiveInteger(summary.includedCount)}
          variant="success"
        />
        <MetricCard
          label="NF excluídas"
          value={formatExecutiveInteger(summary.excludedCount)}
          variant={summary.excludedCount > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Última sync Nomus"
          value={summary.lastNomusSyncAt ? summary.lastNomusSyncAt.slice(0, 16).replace("T", " ") : "—"}
          variant="info"
        />
      </AdminKpiSection>

      <section>
        <h4 className="text-xs font-bold uppercase text-muted-foreground">Possíveis causas da divergência</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {summary.divergenceHints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{audit.nomusComparisonNote}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["included", "Incluídas"],
            ["excluded", "Excluídas"],
            ["all", "Todos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              view === id
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {label} ({id === "included" ? audit.includedRows.length : id === "excluded" ? audit.excludedRows.length : audit.includedRows.length + audit.excludedRows.length})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[960px] text-xs">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Incluído</th>
              <th className="px-3 py-2">Fonte</th>
              <th className="px-3 py-2">Pedido / NF</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Data competência</th>
              <th className="px-3 py-2">Valor dashboard</th>
              <th className="px-3 py-2">Motivo exclusão</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.dataSource}-${row.id}`} className="border-b border-border/60">
                <td className="px-3 py-2">{row.includedInBilling ? "Sim" : "Não"}</td>
                <td className="px-3 py-2">{row.dataSource}</td>
                <td className="px-3 py-2">
                  {row.salesOrderCode ?? row.nfNumber ?? "—"}
                  {row.nfKey ? (
                    <p className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">
                      {row.nfKey}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">{row.customerName ?? row.customerDocument ?? "—"}</td>
                <td className="px-3 py-2">{row.competenceDateUsed ?? "—"}</td>
                <td className="px-3 py-2">{formatExecutiveCurrency(row.valueUsedInDashboard)}</td>
                <td className="px-3 py-2 text-amber-800">{row.exclusionReason ?? "—"}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum registro nesta visão.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
