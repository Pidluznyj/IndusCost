import "./finance-ar-overdue-print.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import {
  buildFinanceArOverdueExportQuery,
  buildFinanceArOverdueQuery,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  DEFAULT_FINANCE_AR_OVERDUE_UI_FILTERS,
  FINANCE_AR_OVERDUE_AGING_BUCKETS,
  type FinanceArOverduePayload,
  type FinanceArOverdueUiFilters,
} from "@/src/lib/financeAccountsReceivableOverdueTypes";
import { financeArOverdueExportFilename } from "@/src/lib/financeAccountsReceivableOverdueExport";
import { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE } from "@/src/lib/financeAccountsReceivableManagement";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import {
  FinanceArLoadingBlock,
  FinanceArScrollableTable,
  FinanceArStickyTableHead,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";
import { StatusBadge } from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import { FinanceAccountsReceivableOverduePrintDocument } from "@/src/components/finance/FinanceAccountsReceivableOverduePrintDocument";
import { cn } from "@/src/lib/utils";

function daysOverdueBadgeClass(days: number): string {
  if (days <= 7) return "bg-amber-50 text-amber-900 border-amber-200";
  if (days <= 30) return "bg-orange-50 text-orange-900 border-orange-200";
  if (days <= 60) return "bg-red-50 text-red-900 border-red-200";
  return "bg-red-100 text-red-900 border-red-300";
}

function DaysOverdueBadge({ days }: { days: number }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
        daysOverdueBadgeClass(days)
      )}
    >
      {formatFinanceDaysOverdue(days)} d
    </span>
  );
}

export function FinanceAccountsReceivableOverdueTab({
  globalFilters,
  canExport,
}: {
  globalFilters: FinanceArUiFilters;
  canExport: boolean;
}) {
  const auth = useAuth();
  const [overdueFilters, setOverdueFilters] = useState<FinanceArOverdueUiFilters>(
    DEFAULT_FINANCE_AR_OVERDUE_UI_FILTERS
  );
  const [payload, setPayload] = useState<FinanceArOverduePayload | null>(null);
  const [printPayload, setPrintPayload] = useState<FinanceArOverduePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const query = useMemo(
    () => buildFinanceArOverdueQuery(globalFilters, overdueFilters),
    [globalFilters, overdueFilters]
  );

  const load = useCallback(async (opts?: { skipCache?: boolean }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const url = `/api/finance/accounts-receivable/overdue?${query}`;
    try {
      const data = await fetchUiSessionCachedJson<FinanceArOverduePayload>(url, {
        signal: controller.signal,
        skipCache: opts?.skipCache === true,
      });
      if (controller.signal.aborted) return;
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Falha ao carregar atrasados.");
      setPayload(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const q = buildFinanceArOverdueExportQuery(globalFilters, overdueFilters);
      const res = await fetch(`/api/finance/accounts-receivable/overdue/export.xlsx?${q}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Exportação falhou.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeArOverdueExportFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    setError(null);
    try {
      const q = buildFinanceArOverdueExportQuery(globalFilters, overdueFilters);
      const fullPayload = await fetchJsonOk<FinanceArOverduePayload>(
        `/api/finance/accounts-receivable/overdue?${q}`
      );
      setPrintPayload(fullPayload);
      document.body.classList.add("ar-overdue-print-route");
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              window.print();
              resolve();
            }, 200);
          });
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao preparar impressão.");
    } finally {
      document.body.classList.remove("ar-overdue-print-route");
      setPrinting(false);
    }
  };

  const summary = payload?.summary;
  const filterChips = useMemo(() => {
    const chips: string[] = [];
    if (globalFilters.year) chips.push(`Ano ${globalFilters.year}`);
    if (globalFilters.month) chips.push(`Mês ${globalFilters.month}`);
    if (globalFilters.companyName.trim()) chips.push(`Empresa: ${globalFilters.companyName}`);
    if (globalFilters.personName.trim()) chips.push(`Cliente: ${globalFilters.personName}`);
    if (globalFilters.invoiceIssued !== "all") chips.push(`NF: ${globalFilters.invoiceIssued}`);
    if (overdueFilters.agingBucket) {
      const label = FINANCE_AR_OVERDUE_AGING_BUCKETS.find((b) => b.key === overdueFilters.agingBucket)?.label;
      if (label) chips.push(`Faixa: ${label}`);
    }
    if (overdueFilters.minDaysOverdue.trim()) chips.push(`≥ ${overdueFilters.minDaysOverdue} dias`);
    if (overdueFilters.minOpenBalance.trim()) chips.push(`Saldo ≥ ${overdueFilters.minOpenBalance}`);
    return chips;
  }, [globalFilters, overdueFilters]);

  const emitterName = auth.authUser?.name ?? null;

  return (
    <>
      <div className="ar-overdue-no-print space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#111827]">Atrasados</h3>
            <p className="text-sm text-[#6B7280]">
              Títulos vencidos em aberto para análise e cobrança
            </p>
            <p
              className="text-[11px] text-[#9CA3AF] mt-1 max-w-2xl"
              title={FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE}
            >
              {FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load({ skipCache: true })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-[#111827] hover:bg-[#F9FAFB]"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
            {canExport ? (
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleExport()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-60"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar Excel
              </button>
            ) : null}
            <button
              type="button"
              disabled={printing || loading || !payload}
              onClick={() => void handlePrint()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-60"
            >
              {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Imprimir / PDF
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {filterChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-[11px] font-medium text-[#374151]"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 finance-ar-overdue-filters">
          <label className="text-xs font-semibold text-[#6B7280]">
            Faixa de atraso
            <select
              className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
              value={overdueFilters.agingBucket}
              onChange={(e) =>
                setOverdueFilters((f) => ({ ...f, agingBucket: e.target.value, page: "1" }))
              }
            >
              <option value="">Todas</option>
              {FINANCE_AR_OVERDUE_AGING_BUCKETS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#6B7280]">
            Acima de (dias)
            <input
              className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
              value={overdueFilters.minDaysOverdue}
              onChange={(e) =>
                setOverdueFilters((f) => ({ ...f, minDaysOverdue: e.target.value, page: "1" }))
              }
              placeholder="Ex: 30"
            />
          </label>
          <label className="text-xs font-semibold text-[#6B7280]">
            Saldo mínimo (R$)
            <input
              className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
              value={overdueFilters.minOpenBalance}
              onChange={(e) =>
                setOverdueFilters((f) => ({ ...f, minOpenBalance: e.target.value, page: "1" }))
              }
              placeholder="Ex: 1000"
            />
          </label>
          <label className="text-xs font-semibold text-[#6B7280]">
            Ordenar por
            <select
              className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-1.5 text-sm"
              value={overdueFilters.sortBy}
              onChange={(e) =>
                setOverdueFilters((f) => ({
                  ...f,
                  sortBy: e.target.value as FinanceArOverdueUiFilters["sortBy"],
                  page: "1",
                }))
              }
            >
              <option value="overdueAmount">Maior valor vencido</option>
              <option value="daysOverdue">Maior atraso</option>
              <option value="customer">Cliente</option>
              <option value="dueDate">Vencimento</option>
            </select>
          </label>
        </div>

        {loading && !payload ? (
          <FinanceArLoadingBlock label="atrasados" />
        ) : (
          <>
            <ExecutiveSummarySection
              title="Resumo de inadimplência"
              eyebrow="Carteira vencida no escopo filtrado"
              testId="finance-ar-overdue-summary"
            >
            <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
              <FinanceExecutiveTotalizerCard
                label="Total vencido"
                value="—"
                amount={summary?.totalOverdueAmount}
                amountFormat="currency"
              />
              <FinanceExecutiveTotalizerCard
                label="Títulos vencidos"
                value="—"
                amount={summary?.overdueTitlesCount}
                amountFormat="number"
              />
              <FinanceExecutiveTotalizerCard
                label="Clientes em atraso"
                value="—"
                amount={summary?.overdueCustomersCount}
                amountFormat="number"
              />
              <FinanceExecutiveTotalizerCard
                label="Média dias em atraso"
                value={
                  summary?.averageDaysOverdue != null
                    ? `${formatFinanceInteger(summary.averageDaysOverdue)} d`
                    : "—"
                }
              />
              <FinanceExecutiveTotalizerCard
                label="Maior cliente devedor"
                value={summary?.topOverdueCustomer?.name ?? "—"}
                hint={
                  summary?.topOverdueCustomer
                    ? formatFinanceCurrency(summary.topOverdueCustomer.amount)
                    : undefined
                }
              />
              <FinanceExecutiveTotalizerCard
                label="Acima de 30 dias"
                value="—"
                amount={summary?.over30Amount}
                amountFormat="currency"
              />
              <FinanceExecutiveTotalizerCard
                label="Acima de 60 dias"
                value="—"
                amount={summary?.over60Amount}
                amountFormat="currency"
              />
              <FinanceExecutiveTotalizerCard
                label="Acima de 90 dias"
                value="—"
                amount={summary?.over90Amount}
                amountFormat="currency"
              />
            </SummaryKpiGrid>
            </ExecutiveSummarySection>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
              <h4 className="text-sm font-bold text-[#111827] mb-3">Aging de atraso</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#6B7280] border-b">
                      <th className="py-2 pr-3">Faixa</th>
                      <th className="py-2 pr-3 text-right">Títulos</th>
                      <th className="py-2 pr-3 text-right">Valor</th>
                      <th className="py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payload?.agingBuckets ?? []).map((row) => (
                      <tr key={row.key} className="border-b border-[#F3F4F6]">
                        <td className="py-2 pr-3">{row.bucket}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.titlesCount}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatFinanceCurrency(row.amount)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatFinancePercent(row.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
              <h4 className="text-sm font-bold text-[#111827] mb-3">Ranking de clientes em atraso</h4>
              <FinanceArScrollableTable className="max-h-[360px]" tableClassName="min-w-full text-sm">
                <FinanceArStickyTableHead>
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Cliente</th>
                    <th className="px-2 py-2 text-left">CNPJ/CPF</th>
                    <th className="px-2 py-2 text-right">Títulos</th>
                    <th className="px-2 py-2 text-right">Vencido</th>
                    <th className="px-2 py-2 text-left">Mais antigo</th>
                    <th className="px-2 py-2 text-right">Máx. atraso</th>
                    <th className="px-2 py-2 text-right">Média</th>
                    <th className="px-2 py-2 text-right">%</th>
                  </tr>
                </FinanceArStickyTableHead>
                <tbody>
                  {(payload?.customerRanking ?? []).map((row) => (
                    <tr key={`${row.rank}-${row.customerName}`} className="border-t border-[#F3F4F6]">
                      <td className="px-2 py-2">{row.rank}</td>
                      <td className="px-2 py-2 font-medium">{displayFinanceText(row.customerName)}</td>
                      <td className="px-2 py-2">{displayFinanceText(row.customerDocument)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.titlesCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">
                        {formatFinanceCurrency(row.overdueAmount)}
                      </td>
                      <td className="px-2 py-2">{formatFinanceDate(row.oldestDueDate)}</td>
                      <td className="px-2 py-2 text-right">
                        <DaysOverdueBadge days={row.maxDaysOverdue} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.averageDaysOverdue != null
                          ? `${formatFinanceInteger(row.averageDaysOverdue)} d`
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatFinancePercent(row.percentOfTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </FinanceArScrollableTable>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h4 className="text-sm font-bold text-[#111827]">Títulos atrasados</h4>
                {payload ? (
                  <span className="text-xs text-[#6B7280]">
                    {payload.pagination.total} título(s) · página {payload.pagination.page}/
                    {payload.pagination.totalPages}
                  </span>
                ) : null}
              </div>
              {!loading && payload && payload.overdueTitles.length === 0 ? (
                <p className="text-sm text-[#6B7280] py-8 text-center">
                  Nenhum título vencido em aberto para os filtros selecionados.
                </p>
              ) : (
                <FinanceArScrollableTable className="max-h-[480px]" tableClassName="min-w-full text-sm">
                  <FinanceArStickyTableHead>
                    <tr>
                      <th className="px-2 py-2 text-left">Cliente</th>
                      <th className="px-2 py-2 text-left">CNPJ/CPF</th>
                      <th className="px-2 py-2 text-left">Documento</th>
                      <th className="px-2 py-2 text-left">NF</th>
                      <th className="px-2 py-2 text-left">Vencimento</th>
                      <th className="px-2 py-2 text-right">Atraso</th>
                      <th className="px-2 py-2 text-right">Original</th>
                      <th className="px-2 py-2 text-right">Recebido</th>
                      <th className="px-2 py-2 text-right">Saldo</th>
                      <th className="px-2 py-2 text-left">Pagamento</th>
                      <th className="px-2 py-2 text-left">Empresa</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-left">Origem</th>
                    </tr>
                  </FinanceArStickyTableHead>
                  <tbody>
                    {(payload?.overdueTitles ?? []).map((row) => (
                      <tr key={row.id} className="border-t border-[#F3F4F6]">
                        <td className="px-2 py-2 font-medium">{displayFinanceText(row.customerName)}</td>
                        <td className="px-2 py-2">{displayFinanceText(row.customerDocument)}</td>
                        <td className="px-2 py-2">{displayFinanceText(row.documentNumber)}</td>
                        <td className="px-2 py-2">{displayFinanceText(row.nfeNumber)}</td>
                        <td className="px-2 py-2">{formatFinanceDate(row.dueDate)}</td>
                        <td className="px-2 py-2 text-right">
                          <DaysOverdueBadge days={row.daysOverdue} />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatFinanceCurrency(row.amountReceivable)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatFinanceCurrency(row.amountReceived)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">
                          {formatFinanceCurrency(row.balanceReceivable)}
                        </td>
                        <td className="px-2 py-2">{displayFinanceText(row.paymentMethodName)}</td>
                        <td className="px-2 py-2">{displayFinanceText(row.companyName)}</td>
                        <td className="px-2 py-2">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-2 py-2 text-xs">{row.sourceLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </FinanceArScrollableTable>
              )}
              {payload && payload.pagination.totalPages > 1 ? (
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    type="button"
                    disabled={payload.pagination.page <= 1}
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() =>
                      setOverdueFilters((f) => ({
                        ...f,
                        page: String(Math.max(1, payload.pagination.page - 1)),
                      }))
                    }
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={payload.pagination.page >= payload.pagination.totalPages}
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() =>
                      setOverdueFilters((f) => ({
                        ...f,
                        page: String(payload.pagination.page + 1),
                      }))
                    }
                  >
                    Próxima
                  </button>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>

      {printPayload && typeof document !== "undefined"
        ? createPortal(
            <FinanceAccountsReceivableOverduePrintDocument
              payload={printPayload}
              globalFilters={globalFilters}
              overdueFilters={overdueFilters}
              emitterName={emitterName}
            />,
            document.body
          )
        : null}
    </>
  );
}
