import React, { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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

      <section>
        <h3 className="text-sm font-bold text-[#111827]">Diagnóstico do cálculo</h3>
        <p className="mt-1 text-[11px] text-[#6B7280]">
          Fonte oficial: <strong>{summary.dataSourceOfficial}</strong> · Data base:{" "}
          <strong>{summary.dateBaseLabel}</strong> · Valor: <strong>{summary.valueFieldLabel}</strong> ·
          Período: <strong>{summary.periodLabel}</strong>
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <DiagCard label="Total dashboard" value={formatExecutiveCurrency(summary.dashboardDisplayedTotal)} />
          <DiagCard label="Total bruto encontrado" value={formatExecutiveCurrency(summary.grossFoundTotal)} />
          <DiagCard label="Total excluído" value={formatExecutiveCurrency(summary.excludedTotal)} />
          <DiagCard label="NF incluídas" value={formatExecutiveInteger(summary.includedCount)} />
          <DiagCard label="NF excluídas" value={formatExecutiveInteger(summary.excludedCount)} />
          <DiagCard
            label="Última sync Nomus"
            value={summary.lastNomusSyncAt ? summary.lastNomusSyncAt.slice(0, 16).replace("T", " ") : "—"}
          />
        </div>
      </section>

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

function DiagCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-[#6B7280]">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#111827]">{value}</p>
    </div>
  );
}
