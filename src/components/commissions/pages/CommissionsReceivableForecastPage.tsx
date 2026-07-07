import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type { CommissionsReceivableForecastPayload } from "@/src/components/commissions/commissionsTypes";
import {
  buildReceivableForecastExportQueryString,
  buildReceivableForecastQueryString,
  EMPTY_RECEIVABLE_FORECAST_FILTERS,
  type ReceivableForecastFilters,
} from "@/src/components/commissions/forecast/commissionsReceivableForecastFilters";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type SectionTab = "monthly" | "overdue" | "current" | "future" | "detail";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function bucketLabel(bucket: string): string {
  if (bucket === "overdue") return "Vencido";
  if (bucket === "currentMonth") return "Este mês";
  return "Futuro";
}

export function CommissionsReceivableForecastPage() {
  const [draftFilters, setDraftFilters] = useState<ReceivableForecastFilters>(
    EMPTY_RECEIVABLE_FORECAST_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<ReceivableForecastFilters>(
    EMPTY_RECEIVABLE_FORECAST_FILTERS
  );
  const [data, setData] = useState<CommissionsReceivableForecastPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [sectionTab, setSectionTab] = useState<SectionTab>("monthly");

  useEffect(() => {
    void fetchJsonOk<{ items: Array<{ id: string; name: string }> }>(
      "/api/commissions/persons?page=1&pageSize=200&active=true"
    )
      .then((p) => setPersons(p.items ?? []))
      .catch(() => setPersons([]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildReceivableForecastQueryString(appliedFilters);
      const payload = await fetchJsonOk<CommissionsReceivableForecastPayload>(
        `/api/commissions/receivable-forecast?${qs}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar a previsão."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function exportCsv(format: "monthly" | "detail") {
    setExporting(format);
    try {
      const qs = buildReceivableForecastExportQueryString(appliedFilters, format);
      const res = await fetch(`/api/commissions/receivable-forecast/export?${qs}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `previsao-comissao-${format}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  const cards = data?.cards;
  const pagination = data?.pagination;
  const detailRows = data?.detailRows ?? [];

  const tableRows =
    sectionTab === "overdue"
      ? data?.overdue ?? []
      : sectionTab === "current"
        ? data?.currentMonth
          ? [data.currentMonth]
          : []
        : sectionTab === "future"
          ? data?.futureMonths ?? []
          : data?.monthly ?? [];

  return (
    <div className="space-y-5" data-testid="commissions-receivable-forecast-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Comissões
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">Previsão</h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Comissão prevista conforme títulos a receber em aberto (sem baixa). Agrupamento por{" "}
            <strong>vencimento</strong> (<code>dueDate</code>). Comissão prevista = esperada ainda
            não liberada (<code>commissionPending</code>). Calculado no backend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv("monthly")}
            disabled={exporting != null}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV mensal
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv("detail")}
            disabled={exporting != null}
          >
            <Download className="mr-2 h-4 w-4" />
            CSV detalhe
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <label className="text-sm">
            Vendedor
            <select
              className={`${inputClass} mt-1`}
              value={draftFilters.commissionPersonId}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, commissionPersonId: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Cliente
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.customer}
              onChange={(e) => setDraftFilters((f) => ({ ...f, customer: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Pedido
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.orderCode}
              onChange={(e) => setDraftFilters((f) => ({ ...f, orderCode: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            NF-e
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nfeNumber}
              onChange={(e) => setDraftFilters((f) => ({ ...f, nfeNumber: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            CR
            <input
              className={`${inputClass} mt-1`}
              value={draftFilters.nomusReceivableId}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, nomusReceivableId: e.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            Horizonte (meses)
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min={1}
              value={draftFilters.horizonMonths}
              onChange={(e) => setDraftFilters((f) => ({ ...f, horizonMonths: e.target.value }))}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => setAppliedFilters({ ...draftFilters, page: 1 })}
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => {
              setDraftFilters(EMPTY_RECEIVABLE_FORECAST_FILTERS);
              setAppliedFilters(EMPTY_RECEIVABLE_FORECAST_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {cards ? (
        <CommissionsKpiSection
          title="Resumo de comissões previstas"
          eyebrow="Projeção por vencimento de títulos"
          testId="forecast-cards"
        >
          <FinanceKpiCard
            label="Comissão prevista (a vencer)"
            value={formatFinanceCurrency(cards.futureCommissionTotal)}
          />
          <FinanceKpiCard
            label="Comissão vencida pendente"
            value={formatFinanceCurrency(cards.overdueCommissionTotal)}
          />
          <FinanceKpiCard
            label="Valor títulos futuros"
            value={formatFinanceCurrency(cards.futureTitlesAmountTotal)}
          />
          <FinanceKpiCard
            label="Valor títulos vencidos"
            value={formatFinanceCurrency(cards.overdueTitlesAmountTotal)}
          />
          <FinanceKpiCard
            label="Mês com maior previsão"
            value={
              cards.peakMonthLabelPt
                ? `${cards.peakMonthLabelPt} · ${formatFinanceCurrency(cards.peakMonthCommission)}`
                : "—"
            }
          />
          <FinanceKpiCard
            label="Próximo mês previsto"
            value={`${cards.nextMonthLabelPt ?? "—"} · ${formatFinanceCurrency(cards.nextMonthCommission)}`}
          />
        </CommissionsKpiSection>
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando previsão…" /> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["monthly", "Timeline mensal"],
            ["overdue", "Vencido"],
            ["current", "Este mês"],
            ["future", "Próximos meses"],
            ["detail", "Detalhe títulos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              sectionTab === id
                ? "bg-primary text-primary-foreground"
                : "border border-border hover:bg-muted/50"
            }`}
            onClick={() => setSectionTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {sectionTab !== "detail" ? (
        <CommissionsTableScroll>
          <table className="min-w-[900px] text-xs">
            <thead>
              <tr className="border-b text-left uppercase text-muted-foreground">
                <th className="px-2 py-2">Mês vencimento</th>
                <th className="px-2 py-2 text-right">Valor títulos</th>
                <th className="px-2 py-2 text-right">Base comissionável</th>
                <th className="px-2 py-2 text-right">Comissão prevista</th>
                <th className="px-2 py-2 text-right">Títulos</th>
                <th className="px-2 py-2 text-right">Vendedores</th>
                <th className="px-2 py-2">Faixa</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.dueMonthKey} className="border-b">
                  <td className="px-2 py-2 font-medium">{row.dueMonthLabelPt}</td>
                  <td className="px-2 py-2 text-right">
                    {formatFinanceCurrency(row.openTitlesAmount)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {formatFinanceCurrency(row.allocatedBaseAmount)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">
                    {formatFinanceCurrency(row.forecastCommissionAmount)}
                  </td>
                  <td className="px-2 py-2 text-right">{row.titleCount}</td>
                  <td className="px-2 py-2 text-right">{row.sellerCount}</td>
                  <td className="px-2 py-2">{bucketLabel(row.bucket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CommissionsTableScroll>
      ) : null}

      {sectionTab === "detail" && detailRows.length === 0 && !loading ? (
        <CommissionsEmptyState
          title="Nenhum título em aberto"
          description="Títulos baixados não aparecem na previsão."
        />
      ) : null}

      {sectionTab === "detail" && detailRows.length > 0 ? (
        <>
          <CommissionsTableScroll>
            <table className="min-w-[1200px] text-xs">
              <thead>
                <tr className="border-b text-left uppercase text-muted-foreground">
                  <th className="px-2 py-2">Vendedor</th>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-2 py-2">Pedido</th>
                  <th className="px-2 py-2">NF</th>
                  <th className="px-2 py-2">CR</th>
                  <th className="px-2 py-2">Vencimento</th>
                  <th className="px-2 py-2 text-right">Em aberto</th>
                  <th className="px-2 py-2 text-right">Base rateada</th>
                  <th className="px-2 py-2 text-right">Comissão prevista</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Faixa</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={row.lineId} className="border-b">
                    <td className="px-2 py-2">{row.sellerName}</td>
                    <td className="px-2 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-2 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-2 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-2 py-2">{row.nomusReceivableId ?? "—"}</td>
                    <td className="px-2 py-2">{formatDate(row.dueDate)}</td>
                    <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.openAmount)}</td>
                    <td className="px-2 py-2 text-right">
                      {formatFinanceCurrency(row.allocatedBaseAmount)}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {formatFinanceCurrency(row.forecastCommissionAmount)}
                    </td>
                    <td className="px-2 py-2">{row.receivableTitleStatus}</td>
                    <td className="px-2 py-2">{bucketLabel(row.bucket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CommissionsTableScroll>
          {pagination ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} linhas)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page <= 1}
                  onClick={() =>
                    setAppliedFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setAppliedFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
