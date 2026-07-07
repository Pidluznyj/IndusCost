import React, { useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Scale,
} from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { CommissionOutOfTableFlag } from "@/src/components/commissions/CommissionOutOfTableBadge";
import { CommissionsApuracaoFiltersPanel } from "@/src/components/commissions/apuracao/CommissionsApuracaoFiltersPanel";
import {
  EMPTY_COMMISSIONS_APURACAO_FILTERS,
  type CommissionsApuracaoFilters,
} from "@/src/components/commissions/apuracao/commissionsApuracaoFilters";
import {
  useApuracaoExport,
  useCommissionsApuracaoData,
} from "@/src/components/commissions/apuracao/useCommissionsApuracaoData";

function apuracaoStatusLabel(status: string): string {
  const map: Record<string, string> = {
    CALCULADA: "Calculada",
    LIBERADA: "Liberada",
    PAGA: "Paga",
    PENDENTE_RECEBIMENTO: "Pendente recebimento",
    DIVERGENTE: "Divergente",
    BLOQUEADA: "Bloqueada",
  };
  return map[status] ?? status;
}

function apuracaoStatusClass(status: string): string {
  if (status === "DIVERGENTE") return "bg-red-50 text-red-800 ring-1 ring-red-200";
  if (status === "BLOQUEADA") return "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
  if (status === "PAGA" || status === "LIBERADA") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (status === "PENDENTE_RECEBIMENTO") return "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
  return "bg-blue-50 text-blue-800 ring-1 ring-blue-200";
}

export function CommissionsApuracaoPage() {
  const [draftFilters, setDraftFilters] = useState<CommissionsApuracaoFilters>(
    EMPTY_COMMISSIONS_APURACAO_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsApuracaoFilters>(
    EMPTY_COMMISSIONS_APURACAO_FILTERS
  );

  const { data, loading, error, reload } = useCommissionsApuracaoData(appliedFilters);
  const { exportCsv, exporting } = useApuracaoExport(appliedFilters);

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  const totals = data?.totals;
  const lines = data?.lines ?? [];
  const diagnostics = data?.diagnostics;
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-apuracao-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Relatório auditável
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Apuração de Comissão
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Demonstrativo por vendedor, NF-e e conta a receber — dados do motor oficial IndusCost,
            com conciliação Nomus e motivos de divergência.
          </p>
        </div>
        <button
          type="button"
          disabled={exporting || loading}
          onClick={() => void exportCsv()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </button>
      </div>

      <CommissionsApuracaoFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters })}
        disabled={loading}
      />

      {diagnostics?.message ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="commissions-apuracao-diagnostics"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Diagnóstico do período</p>
            <p className="mt-1">{diagnostics.message}</p>
            <p className="mt-2 text-xs text-amber-800">
              Registros: {diagnostics.recordsInPeriod} · Confirmados:{" "}
              {diagnostics.recordsConfirmedStatus} · Previstos: {diagnostics.recordsForecastOnly} ·
              Filtro por: {diagnostics.periodBasis === "confirmedAt" ? "data NF-e/confirmação" : "data cálculo"}
            </p>
          </div>
        </div>
      ) : null}

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <CommissionsLoading label="Carregando apuração…" /> : null}

      {totals ? (
        <CommissionsKpiSection
          title="Resumo da apuração"
          eyebrow="Totais consolidados do período filtrado"
          testId="commissions-apuracao-kpi"
        >
          <FinanceKpiCard
            label="Base calculada"
            value=""
            amount={totals.calculationBaseTotal}
            amountFormat="currency"
            icon={FileSpreadsheet}
          />
          <FinanceKpiCard
            label="Comissão calculada"
            value=""
            amount={totals.commissionCalculatedTotal}
            amountFormat="currency"
            icon={Scale}
          />
          <FinanceKpiCard
            label="Comissão liberada"
            value=""
            amount={totals.commissionReleasedTotal}
            amountFormat="currency"
            icon={Scale}
            tone="success"
          />
          <FinanceKpiCard
            label="Saldo a pagar"
            value=""
            amount={totals.balanceTotal}
            amountFormat="currency"
            icon={Scale}
            tone="warning"
          />
          <FinanceKpiCard
            label="Divergências"
            value={String(totals.divergenceCount)}
            icon={AlertTriangle}
            tone={totals.divergenceCount > 0 ? "danger" : "neutral"}
          />
          {totals.nomusReferenceCommission != null ? (
            <FinanceKpiCard
              label="Δ vs Nomus"
              value=""
              amount={totals.nomusDiffAmount ?? 0}
              amountFormat="currency"
              icon={Scale}
              tone={
                totals.nomusDiffAmount != null && Math.abs(totals.nomusDiffAmount) > 1
                  ? "warning"
                  : "success"
              }
              helperText={`Ref. Nomus: ${formatFinanceCurrency(totals.nomusReferenceCommission)}`}
            />
          ) : null}
        </CommissionsKpiSection>
      ) : null}

      {!loading && !error && data ? (
        lines.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma linha de apuração"
            description="Ajuste os filtros ou execute o recálculo do período. Verifique o diagnóstico acima."
            testId="commissions-apuracao-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll testId="commissions-apuracao-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Vendedor</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">NF-e / CR</th>
                  <th className="px-3 py-2 text-right font-medium">Duplicata</th>
                  <th className="px-3 py-2 text-right font-medium">Base</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão</th>
                  <th className="px-3 py-2 text-right font-medium">Liberada</th>
                  <th className="px-3 py-2 text-left font-medium">Faixa</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {lines.map((row) => (
                  <tr key={row.lineId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">{row.commissionPersonName}</td>
                    <td className="px-3 py-2 max-w-[12rem] truncate" title={row.customerName ?? ""}>
                      {row.customerName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.nfeNumber ?? "—"}
                      {row.receivableCode ? (
                        <span className="block text-muted-foreground">CR {row.receivableCode}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.duplicateAmount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.calculationBase)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.ratePercent.toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatFinanceCurrency(row.commissionCalculated)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.commissionReleased)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.commercialTierName ?? row.ruleName ?? "—"}
                      <CommissionOutOfTableFlag show={row.outOfTablePrice} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${apuracaoStatusClass(row.apuracaoStatus)}`}
                        title={row.blockReason ?? undefined}
                      >
                        {apuracaoStatusLabel(row.apuracaoStatus)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Página {pagination.page} de {pagination.totalPages} ({pagination.total} linhas)
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    className="rounded-lg border border-border p-2 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                    className="rounded-lg border border-border p-2 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}
