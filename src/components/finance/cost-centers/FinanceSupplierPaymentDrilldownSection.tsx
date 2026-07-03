import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { buildFinanceCostCentersDashboardQuery } from "@/src/lib/financeCostCentersPageTypes";
import type {
  CostCenterSupplierPaymentSummaryPayload,
  CostCenterSupplierPaymentSummaryRow,
  CostCenterSupplierPaymentTitleRow,
  CostCenterSupplierPaymentTitlesPayload,
  CostCenterSupplierPaymentYearRow,
  CostCenterSupplierPaymentYearsPayload,
} from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import { COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

type DrilldownStep = "suppliers" | "years" | "titles";

type Props = {
  filters: FinanceCostCentersUiFilters;
};

function buildSupplierPaymentQuery(
  filters: FinanceCostCentersUiFilters,
  extra: Record<string, string | number | undefined> = {}
): string {
  const base = buildFinanceCostCentersDashboardQuery(filters);
  const q = new URLSearchParams(base);
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") continue;
    q.set(key, String(value));
  }
  return q.toString();
}

function SupplierPaymentCard({
  row,
  onSelect,
}: {
  row: CostCenterSupplierPaymentSummaryRow;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        financeBiCardClass,
        "text-left p-4 space-y-3 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      )}
      data-testid="finance-supplier-payment-card"
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground truncate" title={row.supplierDisplayName}>
          {row.supplierDisplayName}
        </p>
        {row.supplierDocument ? (
          <p className="text-[11px] text-muted-foreground truncate" title={row.supplierDocument}>
            {row.supplierDocument}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Pago no período</p>
          <p className="font-semibold tabular-nums">{formatFinanceKpiCurrency(row.totalPaidAmount)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Participação</p>
          <p className="font-semibold tabular-nums">{formatFinancePercent(row.percentageOfTotalPaid)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Títulos pagos</p>
          <p className="font-semibold tabular-nums">{row.paidTitlesCount}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Último pagamento</p>
          <p className="font-semibold">{formatFinanceDate(row.lastPaymentDate)}</p>
        </div>
      </div>
      <p className="text-[11px] font-semibold text-primary">Ver histórico anual →</p>
    </button>
  );
}

function YearPaymentCard({
  row,
  onSelect,
}: {
  row: CostCenterSupplierPaymentYearRow;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        financeBiCardClass,
        "text-left p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      )}
      data-testid="finance-supplier-payment-year-card"
    >
      <FinanceKpiCard
        label={String(row.year)}
        value={formatFinanceKpiCurrency(row.totalPaidAmount)}
        subtitle={`${row.paidTitlesCount} título(s)${
          row.peakMonthLabel && row.peakMonthAmount
            ? ` · pico ${row.peakMonthLabel}: ${formatFinanceKpiCurrency(row.peakMonthAmount)}`
            : ""
        }`}
        compact
      />
    </button>
  );
}

export function FinanceSupplierPaymentDrilldownSection({ filters }: Props) {
  const [summary, setSummary] = useState<CostCenterSupplierPaymentSummaryPayload | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const [search, setSearch] = useState("");

  const [panelOpen, setPanelOpen] = useState(false);
  const [step, setStep] = useState<DrilldownStep>("years");
  const [selectedSupplier, setSelectedSupplier] = useState<CostCenterSupplierPaymentSummaryRow | null>(
    null
  );
  const [yearsPayload, setYearsPayload] = useState<CostCenterSupplierPaymentYearsPayload | null>(null);
  const [loadingYears, setLoadingYears] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [titlesPayload, setTitlesPayload] = useState<CostCenterSupplierPaymentTitlesPayload | null>(null);
  const [loadingTitles, setLoadingTitles] = useState(false);
  const [titlesPage, setTitlesPage] = useState(1);
  const [titlesSearch, setTitlesSearch] = useState("");
  const [titlesSearchDraft, setTitlesSearchDraft] = useState("");

  const filterQuery = useMemo(() => buildFinanceCostCentersDashboardQuery(filters), [filters]);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CostCenterSupplierPaymentSummaryPayload>(
        `/api/finance/cost-centers/supplier-payment-summary?${filterQuery}`,
        { credentials: "include" }
      );
      setSummary(payload);
      setVisibleCount(12);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar pagamentos por fornecedor.", e));
      setSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }, [filterQuery]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const filteredSuppliers = useMemo(() => {
    const rows = summary?.supplierPaymentSummary ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.supplierDisplayName.toLowerCase().includes(q) ||
        (row.supplierDocument ?? "").toLowerCase().includes(q)
    );
  }, [summary, search]);

  const visibleSuppliers = filteredSuppliers.slice(0, visibleCount);

  const openSupplier = async (row: CostCenterSupplierPaymentSummaryRow) => {
    setSelectedSupplier(row);
    setPanelOpen(true);
    setStep("years");
    setSelectedYear(null);
    setTitlesPayload(null);
    setLoadingYears(true);
    try {
      const qs = buildSupplierPaymentQuery(filters, {
        supplierKey: row.supplierKey,
        supplierDisplayName: row.supplierDisplayName,
      });
      const payload = await fetchJsonOk<CostCenterSupplierPaymentYearsPayload>(
        `/api/finance/cost-centers/supplier-payment-years?${qs}`,
        { credentials: "include" }
      );
      setYearsPayload(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar histórico anual.", e));
      setYearsPayload(null);
    } finally {
      setLoadingYears(false);
    }
  };

  const openYear = async (year: number) => {
    if (!selectedSupplier) return;
    setSelectedYear(year);
    setStep("titles");
    setTitlesPage(1);
    setTitlesSearch("");
    setTitlesSearchDraft("");
    await loadTitles(selectedSupplier, year, 1, "");
  };

  const loadTitles = async (
    supplier: CostCenterSupplierPaymentSummaryRow,
    year: number,
    page: number,
    searchValue: string
  ) => {
    setLoadingTitles(true);
    try {
      const qs = buildSupplierPaymentQuery(filters, {
        supplierKey: supplier.supplierKey,
        supplierDisplayName: supplier.supplierDisplayName,
        year,
        page,
        pageSize: 50,
        search: searchValue || undefined,
      });
      const payload = await fetchJsonOk<CostCenterSupplierPaymentTitlesPayload>(
        `/api/finance/cost-centers/supplier-payment-titles?${qs}`,
        { credentials: "include" }
      );
      setTitlesPayload(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar títulos pagos.", e));
      setTitlesPayload(null);
    } finally {
      setLoadingTitles(false);
    }
  };

  const closePanel = () => {
    setPanelOpen(false);
    setSelectedSupplier(null);
    setYearsPayload(null);
    setTitlesPayload(null);
    setSelectedYear(null);
    setStep("years");
  };

  const breadcrumb =
    selectedSupplier == null
      ? "Fornecedores"
      : selectedYear == null
        ? `Fornecedores › ${selectedSupplier.supplierDisplayName}`
        : `Fornecedores › ${selectedSupplier.supplierDisplayName} › ${selectedYear}`;

  return (
    <section className="space-y-4" data-testid="finance-supplier-payment-drilldown-section">
      <div>
        <h3 className="text-base font-bold text-foreground">Pagamentos por Fornecedor</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Valor pago por fornecedor no período selecionado.
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          {summary?.periodLabel
            ? `Período: ${summary.periodLabel} · Top fornecedores pagos no período selecionado.`
            : "Top fornecedores pagos no período selecionado."}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1" title={COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE}>
          {COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE}
        </p>
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void loadSummary()} onDismiss={() => setError(null)} />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FinanceCostCenterGridSearchBar
          value={search}
          onChange={setSearch}
          placeholder="Buscar fornecedor ou documento"
          testId="finance-supplier-payment-search"
        />
        {summary ? (
          <p className="text-xs text-muted-foreground">
            Total pago:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatFinanceKpiCurrency(summary.totalPaidAmountAllSuppliers)}
            </span>{" "}
            · {summary.suppliersCount} fornecedor(es)
          </p>
        ) : null}
      </div>

      {loadingSummary ? <FinanceModuleLoadingBlock label="Carregando pagamentos por fornecedor…" /> : null}

      {!loadingSummary && (summary?.supplierPaymentSummary.length ?? 0) === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum pagamento encontrado"
          description="Nenhum pagamento encontrado para os filtros selecionados."
        />
      ) : null}

      {!loadingSummary && visibleSuppliers.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleSuppliers.map((row) => (
              <SupplierPaymentCard key={row.supplierKey} row={row} onSelect={() => void openSupplier(row)} />
            ))}
          </div>
          {filteredSuppliers.length > visibleCount ? (
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              onClick={() => setVisibleCount((count) => count + 12)}
            >
              Ver mais fornecedores ({filteredSuppliers.length - visibleCount} restantes)
            </button>
          ) : null}
        </>
      ) : null}

      {panelOpen && selectedSupplier
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Fechar painel"
                onClick={closePanel}
              />
              <div
                className={cn(
                  financeBiCardClass,
                  "relative ml-auto flex h-full w-full max-w-5xl flex-col overflow-hidden shadow-2xl"
                )}
                data-testid="finance-supplier-payment-drilldown-panel"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{breadcrumb}</p>
                    <h3 className="text-lg font-bold truncate">
                      {step === "years"
                        ? `Histórico de pagamentos — ${selectedSupplier.supplierDisplayName}`
                        : `Títulos pagos — ${selectedSupplier.supplierDisplayName} (${selectedYear})`}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {yearsPayload?.note ??
                        "Histórico anual do fornecedor com os filtros gerenciais aplicáveis."}
                    </p>
                  </div>
                  <button type="button" className="rounded-lg border p-2" onClick={closePanel} aria-label="Fechar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {step === "years" ? (
                    <>
                      {loadingYears ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando anos…
                        </div>
                      ) : null}
                      {!loadingYears && (yearsPayload?.years.length ?? 0) === 0 ? (
                        <FinanceModuleEmptyState
                          title="Sem histórico anual"
                          description="Não há histórico anual disponível para este fornecedor."
                        />
                      ) : null}
                      {!loadingYears && yearsPayload && yearsPayload.years.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {yearsPayload.years.map((yearRow) => (
                            <YearPaymentCard
                              key={yearRow.year}
                              row={yearRow}
                              onSelect={() => void openYear(yearRow.year)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
                          onClick={() => {
                            setStep("years");
                            setSelectedYear(null);
                            setTitlesPayload(null);
                          }}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Voltar para anos
                        </button>
                        <FinanceCostCenterGridSearchBar
                          value={titlesSearchDraft}
                          onChange={setTitlesSearchDraft}
                          placeholder="Buscar documento, NF, descrição…"
                          testId="finance-supplier-payment-titles-search"
                        />
                        <button
                          type="button"
                          className="rounded-lg border px-3 py-2 text-sm font-semibold"
                          onClick={() => {
                            setTitlesSearch(titlesSearchDraft);
                            setTitlesPage(1);
                            if (selectedSupplier && selectedYear != null) {
                              void loadTitles(selectedSupplier, selectedYear, 1, titlesSearchDraft);
                            }
                          }}
                        >
                          Buscar
                        </button>
                      </div>

                      {loadingTitles ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando títulos…
                        </div>
                      ) : null}

                      {titlesPayload ? (
                        <>
                          <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
                            <span className="font-semibold tabular-nums">
                              {formatFinanceCurrency(titlesPayload.totalPaidAmount)}
                            </span>{" "}
                            · {titlesPayload.paidTitlesCount} título(s)
                          </div>
                          <FinanceCostCenterGridTableShell
                            tableClassName="min-w-[980px]"
                            head={
                              <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
                                <th className="px-3 py-2">Pagamento gerencial</th>
                                <th className="px-3 py-2">Baixa operacional</th>
                                <th className="px-3 py-2">Vencimento</th>
                                <th className="px-3 py-2">Documento</th>
                                <th className="px-3 py-2">NF</th>
                                <th className="px-3 py-2">Centro de custo</th>
                                <th className="px-3 py-2 text-right">Valor pago</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2 min-w-[12rem]">Descrição / comentário</th>
                              </tr>
                            }
                            footer={
                              <FinanceCostCenterGridPagination
                                page={titlesPayload.page}
                                totalPages={titlesPayload.totalPages}
                                pageSize={titlesPayload.pageSize}
                                onPageChange={(page) => {
                                  setTitlesPage(page);
                                  if (selectedSupplier && selectedYear != null) {
                                    void loadTitles(selectedSupplier, selectedYear, page, titlesSearch);
                                  }
                                }}
                                onPageSizeChange={() => undefined}
                              />
                            }
                          >
                            {titlesPayload.items.map((row: CostCenterSupplierPaymentTitleRow) => (
                              <tr key={row.accountsPayableId} className="border-b border-border/60 text-xs">
                                <td className="px-3 py-2">{formatFinanceDate(row.paymentDate)}</td>
                                <td className="px-3 py-2">{formatFinanceDate(row.operationalPaymentDate)}</td>
                                <td className="px-3 py-2">{formatFinanceDate(row.dueDate)}</td>
                                <td className="px-3 py-2">{row.documentNumber ?? row.accountsPayableId}</td>
                                <td className="px-3 py-2">{row.sourceInvoiceId ?? "—"}</td>
                                <td className="px-3 py-2" title={row.costCenterCode ?? undefined}>
                                  {row.costCenterName}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                                  {formatFinanceCurrency(row.paidAmount)}
                                </td>
                                <td className="px-3 py-2">{row.statusLabel}</td>
                                <td className="px-3 py-2 max-w-[16rem]">
                                  <p className="line-clamp-2 whitespace-pre-wrap" title={row.descriptiveText}>
                                    {row.descriptiveText}
                                  </p>
                                </td>
                              </tr>
                            ))}
                          </FinanceCostCenterGridTableShell>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </section>
  );
}
